import request from 'supertest'
import { createApp } from '../app'
import { pool } from '../db'

const app = createApp()

// Helper — register + login a user, return the auth token for use in requests
async function createAuthedUser(email: string) {
  const res = await request(app).post('/api/auth/register').send({
    email, password: 'password123', displayName: 'Test User',
  })
  return res.body.token as string
}

beforeEach(async () => {
  // Order matters — children before parents, respecting foreign keys
  await pool.query('DELETE FROM commits')
  await pool.query('DELETE FROM branches')
  await pool.query('DELETE FROM projects')
  await pool.query('DELETE FROM users')
})

afterAll(async () => {
  await pool.end()
})

describe('POST /api/projects', () => {
  it('creates a project with an automatic main branch', async () => {
    const token = await createAuthedUser('owner@example.com')

    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'My Painting', width: 1920, height: 1080 })

    expect(res.status).toBe(201)
    expect(res.body.projectId).toBeDefined()
    expect(res.body.branchId).toBeDefined()

    const branchCheck = await pool.query(
      'SELECT name FROM branches WHERE id = $1', [res.body.branchId]
    )
    expect(branchCheck.rows[0].name).toBe('main')
  })

  it('rejects a request with no auth token', async () => {
    const res = await request(app)
      .post('/api/projects')
      .send({ name: 'No Auth', width: 100, height: 100 })

    expect(res.status).toBe(401)
  })
})

describe('project ownership', () => {
  it('prevents one user from seeing another user\'s projects', async () => {
    const tokenA = await createAuthedUser('userA@example.com')
    const tokenB = await createAuthedUser('userB@example.com')

    await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'User A Project', width: 100, height: 100 })

    const resB = await request(app)
      .get('/api/projects')
      .set('Authorization', `Bearer ${tokenB}`)

    expect(resB.body.projects.length).toBe(0)
  })

  it('prevents one user from deleting another user\'s project', async () => {
    const tokenA = await createAuthedUser('ownerA@example.com')
    const tokenB = await createAuthedUser('attackerB@example.com')

    const createRes = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Protected Project', width: 100, height: 100 })

    const deleteRes = await request(app)
      .delete(`/api/projects/${createRes.body.projectId}`)
      .set('Authorization', `Bearer ${tokenB}`)

    expect(deleteRes.status).toBe(404) // not "403 forbidden" — we don't reveal it exists at all
  })
})

describe('branch protection rules', () => {
  it('refuses to delete the main branch', async () => {
    const token = await createAuthedUser('mainprotect@example.com')

    const { body: project } = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Protect Main', width: 100, height: 100 })

    const res = await request(app)
      .delete(`/api/projects/${project.projectId}/branches/${project.branchId}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(403)
  })

  it('allows deleting a non-main branch created from a commit', async () => {
    const token = await createAuthedUser('branchdelete@example.com')

    const { body: project } = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Branch Delete Test', width: 100, height: 100 })

    // A commit is required as a branch starting point — create a minimal one
    const commitRes = await request(app)
      .post(`/api/projects/${project.projectId}/commits`)
      .query({ message: 'first', branchId: project.branchId })
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('fake-snapshot-data'))

    const newBranchRes = await request(app)
      .post(`/api/projects/${project.projectId}/branches`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'experiment', fromCommitId: commitRes.body.commitId })

    const deleteRes = await request(app)
      .delete(`/api/projects/${project.projectId}/branches/${newBranchRes.body.branchId}`)
      .set('Authorization', `Bearer ${token}`)

    expect(deleteRes.status).toBe(200)
  })
})