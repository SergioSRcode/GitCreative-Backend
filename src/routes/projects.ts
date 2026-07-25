import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { pool } from '../db';
import { uploadSnapshot, downloadSnapshot, uploadSnapshotToKey } from '../storage';
import { v4 as uuidv4 } from 'uuid';

// router entry point /api/auth/
const router = Router();

// applies requireAuth to all routes in this file
router.use(requireAuth);

// ----------------------------------------
// POST /api/projects - creates new project
// ----------------------------------------
router.post('/', async (req: AuthRequest, res: Response) => {
  const { name, width, height } = req.body;
  if (!name || !width || !height) {
    res.status(400).json({ error: 'name, width and height are required' });
    return;
  }

  try {
    const projectId = uuidv4();
    const branchId = uuidv4();

    // creates the project
    await pool.query(
      `INSERT INTO projects (id, user_id, name, width, height)
       VALUES ($1, $2, $3, $4, $5)`,
       [projectId, req.userId, name, width, height]
    );

    // Auto-creates the very first default 'main' branch with no head commit
    await pool.query(
      `INSERT INTO branches (id, project_id, name, head_commit_id)
       VALUES ($1, $2, 'main', NULL)`,
       [branchId, projectId]
    );

    res.status(201).json({ projectId, branchId });
  } catch (err) {
    console.error('Create project error: ', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// ----------------------------------------
// GET /api/projects - lists users projects
// ----------------------------------------
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.name, p.width, p.height,
              p.created_at, p.updated_at,
              p.last_active_branch_id,
              b.id as main_branch_id
       FROM projects p
       LEFT JOIN branches b ON b.project_id = p.id AND b.name = 'main'
       WHERE p.user_id = $1
       ORDER BY p.updated_at DESC`,
      [req.userId]
    );

    res.json({ projects: result.rows });
  } catch (err) {
    console.error('List projects error: ', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// ------------------------------------------------------------------
// PATCH /api/projects/:id/lastBranch - updates last_active_branch_id
// ------------------------------------------------------------------
router.patch('/:id/lastBranch', async (req: AuthRequest, res: Response) => {
  const { id: projectId } = req.params;
  const { branchId } = req.body;

  if (!branchId) {
    res.status(400).json({ error: 'branchId is required' });
    return;
  }

  try {
    const result = await pool.query(
      `UPDATE projects
       SET last_active_branch_id = $1, updated_at = NOW()
       WHERE id = $2 AND user_id = $3
       RETURNING id`,
      [branchId, projectId, req.userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'project not found' });
      return;
    }

    res.json({ updated: true });
  } catch (err) {
    console.error('Update last branch error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// -------------------------------------------------
// POST /api/projects/:id/commits - creates a commit
// -------------------------------------------------
router.post(`/:id/commits`, async (req: AuthRequest, res: Response) => {
  const { id: projectId } = req.params;
  if (Array.isArray(projectId)) return; // ensures projectId is a string
  const { message, branchId, parentCommitId } = req.query as Record<string, string>;
  // the raw .gitcreative binary is sent as a req body
  // express.raw() middleware parses it -> wired in index.ts
  const snapshotData = req.body as Buffer;

  if (!message || !branchId) {
    res.status(400).json({ error: 'message and branchId are required' });
    return;
  }

  try {
    // verifies that the project belongs to curr user
    const projectCheck = await pool.query(
      `SELECT id FROM projects WHERE id = $1 AND user_id = $2`,
      [projectId, req.userId]
    );

    // check if project doesn't belong to user or doesn't exist
    if (projectCheck.rows.length === 0) {
      res.status(404).json({ error: 'project not found' });
      return;
    }

    const commitId = uuidv4();

    // uploads snapshot binary to MinIO
    const snapshotKey = await uploadSnapshot(projectId, commitId, snapshotData);

    // inserts commit record
    await pool.query(
      `INSERT INTO commits (id, project_id, parent_id, message, snapshot_key)
       VALUES ($1, $2, $3, $4, $5)`,
      [commitId, projectId, parentCommitId || null, message, snapshotKey]
    );

    // updates branch HEAD to point to new commit, sets quick-saves to NULL
    await pool.query(
      `UPDATE branches SET head_commit_id = $1, current_snapshot_key = NULL WHERE id = $2`,
      [commitId, branchId]
    );

    // touches project updated_at
    await pool.query(
      `UPDATE projects SET updated_at = NOW() WHERE id = $1`,
      [projectId]
    );

    res.status(201).json({ commitId, snapshotKey });
  } catch (err) {
    console.error('Create commit error: ', err);
    res.status(500).json({ error: 'internal server error' });
  }
});


// GET /api/projects/:id/commits - lists commits
router.get(`/:id/commits`, async (req: AuthRequest, res: Response) => {
  const {id: projectId } = req.params;

  try {
    const projectCheck = await pool.query(
      `SELECT id FROM projects WHERE id = $1 AND user_id = $2`,
      [projectId, req.userId]
    );
    // checks if project doesn't belong to user or doesn't exist
    if (projectCheck.rows.length === 0) {
      res.status(404).json({ error: 'project not found' });
      return;
    }

    // returns commits newest first - frontend renders commits top to bottom
    const result = await pool.query(
      `SELECT id, parent_id, message, snapshot_key, created_at
       FROM commits
       WHERE project_id = $1
       ORDER BY created_at DESC`,
       [projectId]
    );

    res.json({ commits: result.rows });
  } catch (err) {
    console.error('List commits error: ', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// -------------------------------------------------------------
// GET /api/commits/:id/snapshot - downloads a commit's snapshot
// -------------------------------------------------------------

router.get(`/:projectId/commits/:commitId/snapshot`, async (req: AuthRequest, res: Response) => {
  const { projectId, commitId } = req.params;

  try {
    // verifies ownership
    const result = await pool.query(
      `SELECT c.snapshot_key
       FROM commits c
       JOIN projects p ON p.id = c.project_id
       WHERE c.id = $1 AND p.id = $2 AND p.user_id = $3`,
      [commitId, projectId, req.userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'commit not found' });
      return;
    }

    const { snapshot_key } = result.rows[0];
    const data = await downloadSnapshot(snapshot_key);

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${commitId}.gitcreative"`);
    res.send(data);
  } catch (err) {
    console.error('Download snapshot error: ', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// ------------------------------
// GET /api/projects/:id/branches
// ------------------------------
router.get('/:id/branches', async (req: AuthRequest, res: Response) => {
  const { id: projectId } = req.params;

  try {
    const projectCheck = await pool.query(
      `SELECT id FROM projects WHERE id = $1 AND user_id = $2`,
      [projectId, req.userId]
    );

    if (projectCheck.rows.length === 0) {
      res.status(404).json({ error: 'project not found' });
      return;
    }

    const result = await pool.query(
      `SELECT id, name, head_commit_id
       FROM branches
       WHERE project_id = $1
       ORDER BY created_at ASC`,
      [projectId]
    );

    res.json({ branches: result.rows });
  } catch (err) {
    console.error('List branches error: ', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// -----------------------------------------------------
// POST /api/projects/:id/branches - creates a new branch
// -----------------------------------------------------
router.post('/:id/branches', async (req: AuthRequest, res: Response) => {
  const { id: projectId } = req.params;
  const { name, fromCommitId } = req.body;

  if (!name || !fromCommitId) {
    res.status(400).json({ error: 'name and fromCommitId are required' });
    return;
  }

  try {
    const projectCheck = await pool.query(
      `SELECT id FROM projects WHERE id = $1 AND user_id = $2`,
      [projectId, req.userId]
    );

    if (projectCheck.rows.length === 0) {
      res.status(404).json({ error: 'project not found' });
      return;
    }

    // checks branch name isn't already taken on curr project
    const nameCheck = await pool.query(
      `SELECT id FROM branches WHERE project_id = $1 AND name = $2`,
      [projectId, name]
    );

    if (nameCheck.rows.length > 0) {
      res.status(409).json({ error: 'branch name already esists' });
      return;
    }

    const branchId = uuidv4();

    await pool.query(
      `INSERT INTO branches (id, project_id, name, head_commit_id)
       VALUES($1, $2, $3, $4)`,
      [branchId, projectId, name, fromCommitId]
    );

    res.status(201).json({ branchId, name, headCommitId: fromCommitId });
  } catch (err) {
    console.error('Create branch error: ', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// --------------------------------------------------------------
// DELETE /api/projects/:id/branches/:branchId - deletes a branch
// --------------------------------------------------------------
router.delete('/:id/branches/:branchId', async (req: AuthRequest, res: Response) => {
  const { id: projectId, branchId } = req.params;

  try {
    // verifies ownership and gets branch info
    const result = await pool.query(
      `SELECT b.id, b.name
       FROM branches b
       JOIN projects p ON p.id = b.project_id
       WHERE b.id = $1 AND p.id = $2 AND p.user_id = $3`,
       [branchId, projectId, req.userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'branch not found' });
      return;
    }

    // protects main branch - immutable, cannot be deleted.
    if (result.rows[0].name === 'main') {
      res.status(403).json({ error: 'cannot delete the main branch' });
      return;
    }

    await pool.query('DELETE FROM branches WHERE id = $1', [branchId]);
    res.json({ deleted: true });
  } catch (err) {
    console.error('Delete branch error: ', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// --------------------------------------------------------------------
// POST /api/projects/:id/branches/:branchId/head - updates branch HEAD
// --------------------------------------------------------------------
router.post('/:id/branches/:branchId/head', async (req: AuthRequest, res: Response) => {
  const { id: projectId, branchId } = req.params;
  const { headCommitId } = req.body;

  try {
    const result = await pool.query(
      `UPDATE branches b
       SET head_commit_id = $1
       FROM projects p
       WHERE b.id = $2
        AND b.project_id = p.id
        AND p.id = $3
        AND p.user_id = $4
       RETURNING b.id`,
      [headCommitId, branchId, projectId, req.userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'branch not found' });
      return;
    }

    res.json({ updated: true });
  } catch (err) {
    console.error('Update branch head error: ', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// ------------------------------------------------
// GET /api/projects/:id/branches/:branchId/commits
// ------------------------------------------------
// Returns only commits reachable from this branch's HEAD
router.get('/:id/branches/:branchId/commits', async (req: AuthRequest, res: Response) => {
  const { id: projectId, branchId } = req.params;

  try {
    // Verify ownership
    const projectCheck = await pool.query(
      'SELECT id FROM projects WHERE id = $1 AND user_id = $2',
      [projectId, req.userId]
    );
    if (projectCheck.rows.length === 0) {
      res.status(404).json({ error: 'project not found' });
      return;
    }

    // Get the branch HEAD
    const branchResult = await pool.query(
      'SELECT head_commit_id FROM branches WHERE id = $1 AND project_id = $2',
      [branchId, projectId]
    );
    if (branchResult.rows.length === 0) {
      res.status(404).json({ error: 'branch not found' });
      return;
    }

    const headCommitId = branchResult.rows[0].head_commit_id;
    if (!headCommitId) {;
      // Branch has no commits yet
      res.json({ commits: [] });
      return;
    };

    // Walk the parent chain using a recursive CTE (Common Table Expression)
    // This efficiently traverses the linked list in the database without
    // loading all commits and filtering in application code
    const result = await pool.query(
      `WITH RECURSIVE branch_commits AS (
        -- Start at the branch HEAD
        SELECT id, parent_id, message, snapshot_key, created_at
        FROM commits
        WHERE id = $1

        UNION ALL

        -- Follow parent_id links until we reach a commit with no parent
        SELECT c.id, c.parent_id, c.message, c.snapshot_key, c.created_at
        FROM commits c
        INNER JOIN branch_commits bc ON c.id = bc.parent_id
      )
      SELECT * FROM branch_commits
      ORDER BY created_at DESC`,
      [headCommitId]
    );

    res.json({ commits: result.rows });
  } catch (err) {
    console.error('List branch commits error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// --------------------------------------------------------------------------------------------------
// DELETE /api/projects/:id - deleting a project automatically cleans up all its commits and branches 
// --------------------------------------------------------------------------------------------------
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  const { id: projectId } = req.params;

  try {
    const result = await pool.query(
      `DELETE FROM projects WHERE id = $1 AND user_id = $2 RETURNING id`,
      [projectId, req.userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'project not found' });
      return;
    }

    res.json({ deleted: true });
  } catch (err) {
    console.error('Delete project error: ', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// ------------------------------------------------------------------------------------------
// PUT //api/projects/:id/branches/:branchId/save -> allow for quick saves (no history entry)
// ------------------------------------------------------------------------------------------
router.put('/:id/branches/:branchId/save', async (req: AuthRequest, res: Response) => {
  const { id: projectId, branchId } = req.params;
  const snapshotData = req.body as Buffer;

  try {
    const check = await pool.query(
      `SELECT b.id FROM branches b
       JOIN projects p ON p.id = b.project_id
       WHERE b.id = $1 AND p.id = $2 AND p.user_id = $3`,
      [branchId, projectId, req.userId]
    );

    if (check.rows.length === 0) {
      res.status(404).json({ error: 'branch not found' });
      return;
    }

    // reuses a stable key so repeated quick-saves overwrite in place rather than accumulating new objs in MinIO
    const key = `snapshots/${projectId}/${branchId}_quicksave.gitcreative`;
    await uploadSnapshotToKey(key, snapshotData);

    await pool.query(
      `UPDATE branches SET current_snapshot_key = $1 WHERE id = $2`,
      [key, branchId]
    );

    res.json({ saved: true });
  } catch (err) {
    console.error('Quick save error: ', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// ----------------------------------------------------------------------
// GET /api/projects/:id/branches/:branchId/current - loads current state
// loads quick-save if present, else the branch HEAD commit
// ----------------------------------------------------------------------
router.get('/:id/branches/:branchId/current', async (req: AuthRequest, res: Response) => {
  const { id: projectId, branchId } = req.params;

  try {
    const result = await pool.query(
      `SELECT b.current_snapshot_key, c.snapshot_key as head_snapshot_key
       FROM branches b
       JOIN projects p ON p.id = b.project_id
       LEFT JOIN commits c ON c.id = b.head_commit_id
       WHERE b.id = $1 AND p.id = $2 AND p.user_id = $3`,
      [branchId, projectId, req.userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'branch not found' });
      return;
    }

    const { current_snapshot_key, head_snapshot_key } = result.rows[0];
    const key = current_snapshot_key || head_snapshot_key;

    if (!key) {
      res.status(404).json({ error: 'no snapshot available' });
      return;
    }

    const data = await downloadSnapshot(key);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(data);
  } catch (err) {
    console.error('Load current state error: ', err);
    res.status(500).json({ error: 'internal server error' });
  }
});


export default router