import { Router } from 'express';

export const v1OpenApiRouter = Router();

const SPEC = {
  openapi: '3.1.0',
  info: {
    title: 'LeetSquad Public API',
    version: '1.0.0',
    description:
      'Read-only API over the LeetSquad cloud-sync corpus. ' +
      'Cloud Sync users get a personal API key in the extension Settings. ' +
      'Usage terms: https://leetsquad.miro.build/terms.',
  },
  servers: [{ url: 'https://leetsquad.miro.build' }],
  components: {
    securitySchemes: {
      ApiKey: { type: 'http', scheme: 'bearer', bearerFormat: 'ls_pk_*' },
      Jwt: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      Error: {
        type: 'object',
        required: ['error', 'message', 'trace_id'],
        properties: {
          error: { type: 'string' },
          message: { type: 'string' },
          trace_id: { type: 'string' },
        },
      },
    },
  },
  paths: {
    '/api/v1/health': {
      get: {
        summary: 'Liveness probe',
        responses: { '200': { description: '{ok:true}' } },
      },
    },
    '/api/v1/users/{username}': {
      get: {
        summary: 'Fetch a single user\'s solved-slug set',
        security: [{}, { ApiKey: [] }],
        parameters: [
          { name: 'username', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'OK' },
          '400': { description: 'invalid_username' },
          '404': { description: 'not_found' },
        },
      },
    },
    '/api/v1/users/{username}/count': {
      get: {
        summary: 'Solved-problem count for a user',
        security: [{}, { ApiKey: [] }],
        parameters: [
          { name: 'username', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'OK' },
          '400': { description: 'invalid_username' },
          '404': { description: 'not_found' },
        },
      },
    },
    '/api/v1/users': {
      get: {
        summary: 'List published users (paginated)',
        security: [{ ApiKey: [] }],
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200 } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'OK' }, '401': { description: 'missing_key' } },
      },
    },
    '/api/v1/stats': {
      get: {
        summary: 'Aggregate corpus stats',
        responses: { '200': { description: 'OK' } },
      },
    },
    '/api/v1/changes': {
      get: {
        summary: 'Incremental feed of users with updated_at > since',
        security: [{ ApiKey: [] }],
        parameters: [
          { name: 'since', in: 'query', schema: { type: 'integer', minimum: 0 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200 } },
        ],
        responses: { '200': { description: 'OK' } },
      },
    },
    '/api/v1/slugs/{slug}/count': {
      get: {
        summary: 'Count of users who have solved this slug',
        security: [{}, { ApiKey: [] }],
        parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'OK' }, '400': { description: 'bad_slug' } },
      },
    },
    '/api/v1/slugs/{slug}/solvers': {
      get: {
        summary: 'Paginated list of users who have solved this slug',
        security: [{ ApiKey: [] }],
        parameters: [
          { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200 } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'OK' }, '400': { description: 'bad_slug' }, '401': { description: 'missing_key' } },
      },
    },
    '/api/v1/users/me': {
      delete: {
        summary: 'Delete all data belonging to the JWT-authenticated user',
        security: [{ Jwt: [] }],
        responses: { '200': { description: 'OK' }, '401': { description: 'missing_token' } },
      },
    },
    '/api/v1/key': {
      get: {
        summary: 'Public metadata of the caller\'s current API key',
        security: [{ Jwt: [] }],
        responses: { '200': { description: 'OK' }, '401': { description: 'missing_token' } },
      },
    },
    '/api/v1/key/rotate': {
      post: {
        summary: 'Revoke any live keys and issue a new one',
        security: [{ Jwt: [] }],
        responses: { '200': { description: 'OK with new plaintext' }, '401': { description: 'missing_token' } },
      },
    },
  },
};

v1OpenApiRouter.get('/', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.json(SPEC);
});
