import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { pool } from '../db';
import { uploadSnapshot, downloadSnapshot } from '../storage';
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
      `INSERT INTO projects (id, user,id, name, width, height)
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
      `SELECT id, name, width, height, created_at, updated_at
       FROM projects
       WHERE user_id = $1
       ORDER BY updated_at DESC`,
      [req.userId]
    );

    res.json({ projects: result.rows });
  } catch (err) {
    console.error('List projects error: ', err);
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

    // updates branch HEAD to point to new commit
    await pool.query(
      `UPDATE branches SET head_commit_id = $1 WHERE id = $2`,
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

export default router