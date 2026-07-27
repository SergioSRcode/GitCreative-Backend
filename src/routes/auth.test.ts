import request from 'supertest'
import { createApp } from '../app'
import { pool } from '../db'

const app = createApp()

// Clean the users table before each test so tests don't interfere with each other
beforeEach(async () => {
  await pool.query('DELETE FROM users')
})

// Close the DB pool after all tests finish, so Vitest can exit cleanly
afterAll(async () => {
  await pool.end()
})

describe('POST /api/auth/register', () => {
  it('creates a new user and returns a token', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'test@example.com',
        password: 'password123',
        displayName: 'Test User',
      })

    expect(res.status).toBe(201)
    expect(res.body.token).toBeDefined()
    expect(res.body.user.email).toBe('test@example.com')
  })

  it('rejects a duplicate email with 409', async () => {
    await request(app).post('/api/auth/register').send({
      email: 'dupe@example.com', password: 'password123', displayName: 'First',
    })

    const res = await request(app).post('/api/auth/register').send({
      email: 'dupe@example.com', password: 'password123', displayName: 'Second',
    })

    expect(res.status).toBe(409)
  })

  it('rejects a password shorter than 8 characters', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: 'short@example.com', password: 'abc', displayName: 'Test',
    })

    expect(res.status).toBe(400)
  })
})

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await request(app).post('/api/auth/register').send({
      email: 'login@example.com', password: 'password123', displayName: 'Test',
    })
  })

  it('logs in with correct credentials', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: 'login@example.com', password: 'password123',
    })

    expect(res.status).toBe(200)
    expect(res.body.token).toBeDefined()
  })

  it('rejects an incorrect password with 401', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: 'login@example.com', password: 'wrongpassword',
    })

    expect(res.status).toBe(401)
  })

  it('gives the same error for wrong email and wrong password (no user enumeration)', async () => {
    const wrongEmail = await request(app).post('/api/auth/login').send({
      email: 'doesnotexist@example.com', password: 'password123',
    })
    const wrongPassword = await request(app).post('/api/auth/login').send({
      email: 'login@example.com', password: 'wrongpassword',
    })

    expect(wrongEmail.body.error).toBe(wrongPassword.body.error)
  })
})