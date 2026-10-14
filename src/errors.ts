import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of error.issues) fields[issue.path.join('.') || 'request'] ??= issue.message;
    response
      .status(400)
      .json({ error: { message: 'Please check the highlighted fields.', fields } });
    return;
  }
  if (error instanceof ApiError) {
    response.status(error.status).json({
      error: { message: error.message, ...(error.fields ? { fields: error.fields } : {}) },
    });
    return;
  }
  if (error?.code === 11000) {
    response.status(409).json({
      error: {
        message: 'A doctor with this email already exists.',
        fields: { email: 'This email is already in use.' },
      },
    });
    return;
  }
  if (error?.type === 'entity.parse.failed') {
    response.status(400).json({ error: { message: 'Request body must contain valid JSON.' } });
    return;
  }
  if (error?.type === 'entity.too.large') {
    response.status(413).json({ error: { message: 'Request body is too large.' } });
    return;
  }
  console.error('API error:', error?.message || 'Unknown failure');
  response.status(500).json({ error: { message: 'Something went wrong. Please try again.' } });
};
