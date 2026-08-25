'use strict';

class AppError extends Error {
  constructor(message, { code = 'APP_ERROR', status = 500, details } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

module.exports = { AppError };
