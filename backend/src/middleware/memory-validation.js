/**
 * Memory System Validation Middleware
 *
 * Request validation for all memory system endpoints.
 * Provides schema validation and sanitization.
 *
 * Phase 5 - Task 5.2: Request Validation Middleware
 */

import { ValidationError, InvalidSettingsError } from '../services/memory-errors.js';

// ============================================
// Validation Schemas
// ============================================

/**
 * Schema for compression settings
 */
const compressionSettingsSchema = {
  mode: {
    type: 'string',
    enum: ['uniform', 'tiered'],
    required: true
  },
  compactionRatio: {
    type: 'number',
    min: 2,
    max: 50,
    default: 10,
    requiredIf: { mode: 'uniform' }
  },
  aggressiveness: {
    type: 'string',
    enum: ['minimal', 'moderate', 'aggressive'],
    default: 'moderate'
  },
  tierPreset: {
    type: 'string',
    enum: ['gentle', 'standard', 'aggressive'],
    default: 'standard',
    requiredIf: { mode: 'tiered' }
  },
  customTiers: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        endPercent: { type: 'number', min: 1, max: 100, required: true },
        compactionRatio: { type: 'number', min: 2, max: 50, required: true },
        aggressiveness: { type: 'string', enum: ['minimal', 'moderate', 'aggressive'] }
      }
    }
  },
  model: {
    type: 'string',
    enum: ['opus', 'sonnet', 'haiku'],
    default: 'opus'
  },
  skipFirstMessages: {
    type: 'number',
    min: 0,
    max: 1000,
    default: 0
  },
  keepitMode: {
    type: 'string',
    enum: ['decay', 'preserve-all', 'ignore'],
    default: 'ignore'
  },
  sessionDistance: {
    type: 'number',
    min: 1,
    max: 100
  }
};

/**
 * Schema for composition request
 */
const compositionRequestSchema = {
  name: {
    type: 'string',
    minLength: 1,
    maxLength: 128,
    required: true
  },
  description: {
    type: 'string',
    maxLength: 1024,
    default: ''
  },
  components: {
    type: 'array',
    minItems: 1,
    required: true,
    items: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', required: true },
        versionId: { type: 'string' },
        weight: { type: 'number', min: 0.01, max: 100 },
        recompressSettings: { type: 'object' }
      }
    }
  },
  totalTokenBudget: {
    type: 'number',
    min: 1000,
    max: 2000000,
    required: true
  },
  allocationStrategy: {
    type: 'string',
    enum: ['equal', 'proportional', 'recency', 'inverse-recency', 'custom'],
    default: 'equal'
  },
  outputFormat: {
    type: 'string',
    enum: ['md', 'jsonl', 'both'],
    default: 'both'
  },
  model: {
    type: 'string',
    enum: ['opus', 'sonnet', 'haiku'],
    default: 'opus'
  }
};

/**
 * Schema for project/session IDs
 */
const idSchema = {
  projectId: {
    type: 'string',
    pattern: /^[a-zA-Z0-9_\-]+$/,
    minLength: 1,
    maxLength: 256
  },
  sessionId: {
    type: 'string',
    pattern: /^[a-zA-Z0-9_\-]+$/,
    minLength: 1,
    maxLength: 256
  },
  versionId: {
    type: 'string',
    pattern: /^(original|v\d{3})$/,
    minLength: 1,
    maxLength: 32
  },
  compositionId: {
    type: 'string',
    pattern: /^[a-f0-9\-]{36}$/,
    minLength: 36,
    maxLength: 36
  },
  markerId: {
    type: 'string',
    minLength: 1,
    maxLength: 256
  }
};

/**
 * Schema for keepit marker update
 */
const keepitUpdateSchema = {
  weight: {
    type: 'number',
    min: 0,
    max: 1,
    required: true
  },
  createBackup: {
    type: 'boolean',
    default: true
  }
};

/**
 * Schema for keepit marker creation
 */
const keepitCreateSchema = {
  messageUuid: {
    type: 'string',
    required: true
  },
  content: {
    type: 'string',
    minLength: 1,
    required: true
  },
  weight: {
    type: 'number',
    min: 0,
    max: 1,
    required: true
  },
  createBackup: {
    type: 'boolean',
    default: true
  }
};

/**
 * Schema for import options
 */
const importOptionsSchema = {
  mode: {
    type: 'string',
    enum: ['merge', 'replace'],
    default: 'merge'
  }
};

// ============================================
// Validation Functions
// ============================================

/**
 * Validate a value against a schema field definition
 *
 * @param {any} value - Value to validate
 * @param {Object} schema - Schema field definition
 * @param {string} fieldName - Name of the field (for error messages)
 * @returns {Object} { valid: boolean, errors: string[], value: any }
 */
function validateField(value, schema, fieldName) {
  const errors = [];
  let validatedValue = value;

  // Handle undefined/null
  if (value === undefined || value === null) {
    if (schema.required) {
      errors.push(`${fieldName} is required`);
      return { valid: false, errors, value: undefined };
    }
    if (schema.default !== undefined) {
      return { valid: true, errors: [], value: schema.default };
    }
    return { valid: true, errors: [], value: undefined };
  }

  // Type validation
  switch (schema.type) {
    case 'string':
      if (typeof value !== 'string') {
        errors.push(`${fieldName} must be a string`);
      } else {
        if (schema.minLength !== undefined && value.length < schema.minLength) {
          errors.push(`${fieldName} must be at least ${schema.minLength} characters`);
        }
        if (schema.maxLength !== undefined && value.length > schema.maxLength) {
          errors.push(`${fieldName} must be at most ${schema.maxLength} characters`);
        }
        if (schema.pattern && !schema.pattern.test(value)) {
          errors.push(`${fieldName} has invalid format`);
        }
        if (schema.enum && !schema.enum.includes(value)) {
          errors.push(`${fieldName} must be one of: ${schema.enum.join(', ')}`);
        }
      }
      break;

    case 'number':
      if (typeof value !== 'number' || isNaN(value)) {
        errors.push(`${fieldName} must be a number`);
      } else {
        if (schema.min !== undefined && value < schema.min) {
          errors.push(`${fieldName} must be at least ${schema.min}`);
        }
        if (schema.max !== undefined && value > schema.max) {
          errors.push(`${fieldName} must be at most ${schema.max}`);
        }
      }
      break;

    case 'boolean':
      if (typeof value !== 'boolean') {
        errors.push(`${fieldName} must be a boolean`);
      }
      break;

    case 'array':
      if (!Array.isArray(value)) {
        errors.push(`${fieldName} must be an array`);
      } else {
        if (schema.minItems !== undefined && value.length < schema.minItems) {
          errors.push(`${fieldName} must have at least ${schema.minItems} items`);
        }
        if (schema.maxItems !== undefined && value.length > schema.maxItems) {
          errors.push(`${fieldName} must have at most ${schema.maxItems} items`);
        }
        // Validate array items
        if (schema.items && errors.length === 0) {
          value.forEach((item, index) => {
            const itemResult = validateField(item, schema.items, `${fieldName}[${index}]`);
            errors.push(...itemResult.errors);
          });
        }
      }
      break;

    case 'object':
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        errors.push(`${fieldName} must be an object`);
      } else if (schema.properties) {
        // Validate object properties
        for (const [propName, propSchema] of Object.entries(schema.properties)) {
          const propResult = validateField(value[propName], propSchema, `${fieldName}.${propName}`);
          errors.push(...propResult.errors);
        }
      }
      break;
  }

  return {
    valid: errors.length === 0,
    errors,
    value: validatedValue
  };
}

/**
 * Validate an object against a schema
 *
 * @param {Object} data - Data to validate
 * @param {Object} schema - Validation schema
 * @returns {Object} { valid: boolean, errors: string[], data: Object }
 */
function validateObject(data, schema) {
  const errors = [];
  const validatedData = {};

  for (const [fieldName, fieldSchema] of Object.entries(schema)) {
    const result = validateField(data[fieldName], fieldSchema, fieldName);
    errors.push(...result.errors);

    if (result.value !== undefined) {
      validatedData[fieldName] = result.value;
    }
  }

  // Check conditional requirements (requiredIf)
  for (const [fieldName, fieldSchema] of Object.entries(schema)) {
    if (fieldSchema.requiredIf && validatedData[fieldName] === undefined) {
      for (const [condField, condValue] of Object.entries(fieldSchema.requiredIf)) {
        if (validatedData[condField] === condValue) {
          errors.push(`${fieldName} is required when ${condField} is "${condValue}"`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    data: validatedData
  };
}

// ============================================
// Express Middleware
// ============================================

/**
 * Validate path parameters (projectId, sessionId, etc.)
 */
export function validateParams(req, res, next) {
  const errors = [];

  if (req.params.projectId) {
    const result = validateField(req.params.projectId, idSchema.projectId, 'projectId');
    errors.push(...result.errors);
  }

  if (req.params.sessionId) {
    const result = validateField(req.params.sessionId, idSchema.sessionId, 'sessionId');
    errors.push(...result.errors);
  }

  if (req.params.versionId) {
    // Version ID can be "original" or "v###" pattern
    if (req.params.versionId !== 'original' && !/^v\d{3}$/.test(req.params.versionId)) {
      errors.push('versionId must be "original" or format "v###" (e.g., v001)');
    }
  }

  if (req.params.compositionId) {
    const result = validateField(req.params.compositionId, idSchema.compositionId, 'compositionId');
    errors.push(...result.errors);
  }

  if (req.params.markerId) {
    const result = validateField(req.params.markerId, idSchema.markerId, 'markerId');
    errors.push(...result.errors);
  }

  if (errors.length > 0) {
    return next(new ValidationError('Invalid path parameters', null, errors));
  }

  next();
}

/**
 * Validate compression settings in request body
 */
export function validateCompressionSettings(req, res, next) {
  const result = validateObject(req.body, compressionSettingsSchema);

  if (!result.valid) {
    return next(new InvalidSettingsError('Invalid compression settings', result.errors));
  }

  // Merge validated data with original (to preserve extra fields)
  req.body = { ...req.body, ...result.data };
  next();
}

/**
 * Validate composition request
 */
export function validateCompositionRequest(req, res, next) {
  const result = validateObject(req.body, compositionRequestSchema);

  if (!result.valid) {
    return next(new ValidationError('Invalid composition request', null, result.errors));
  }

  req.body = { ...req.body, ...result.data };
  next();
}

/**
 * Validate keepit marker update
 */
export function validateKeepitUpdate(req, res, next) {
  const result = validateObject(req.body, keepitUpdateSchema);

  if (!result.valid) {
    return next(new ValidationError('Invalid keepit update', null, result.errors));
  }

  req.body = { ...req.body, ...result.data };
  next();
}

/**
 * Validate keepit marker creation
 */
export function validateKeepitCreate(req, res, next) {
  const result = validateObject(req.body, keepitCreateSchema);

  if (!result.valid) {
    return next(new ValidationError('Invalid keepit creation request', null, result.errors));
  }

  req.body = { ...req.body, ...result.data };
  next();
}

/**
 * Validate import options
 */
export function validateImportOptions(req, res, next) {
  const result = validateObject(req.body, importOptionsSchema);

  if (!result.valid) {
    return next(new ValidationError('Invalid import options', null, result.errors));
  }

  req.body = { ...req.body, ...result.data };
  next();
}

/**
 * Validate query parameters for format
 */
export function validateFormatQuery(req, res, next) {
  const validFormats = ['md', 'jsonl', 'metadata'];
  const format = req.query.format || 'md';

  if (!validFormats.includes(format)) {
    return next(new ValidationError(
      `Invalid format: ${format}. Must be one of: ${validFormats.join(', ')}`,
      'format'
    ));
  }

  req.query.format = format;
  next();
}

/**
 * Validate pagination query parameters
 */
export function validatePagination(req, res, next) {
  const errors = [];

  if (req.query.limit !== undefined) {
    const limit = parseInt(req.query.limit, 10);
    if (isNaN(limit) || limit < 1 || limit > 1000) {
      errors.push('limit must be a number between 1 and 1000');
    } else {
      req.query.limit = limit;
    }
  }

  if (req.query.offset !== undefined) {
    const offset = parseInt(req.query.offset, 10);
    if (isNaN(offset) || offset < 0) {
      errors.push('offset must be a non-negative number');
    } else {
      req.query.offset = offset;
    }
  }

  if (errors.length > 0) {
    return next(new ValidationError('Invalid pagination parameters', null, errors));
  }

  next();
}

/**
 * Sanitize string input to prevent injection
 */
export function sanitizeString(value) {
  if (typeof value !== 'string') return value;

  return value
    .replace(/[<>]/g, '') // Remove angle brackets
    .trim();
}

/**
 * Validate and sanitize request body
 */
export function sanitizeRequestBody(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    sanitizeObject(req.body);
  }
  next();
}

function sanitizeObject(obj) {
  for (const key of Object.keys(obj)) {
    if (typeof obj[key] === 'string') {
      obj[key] = sanitizeString(obj[key]);
    } else if (obj[key] && typeof obj[key] === 'object') {
      sanitizeObject(obj[key]);
    }
  }
}

// ============================================
// Utility Exports
// ============================================

export {
  compressionSettingsSchema,
  compositionRequestSchema,
  keepitUpdateSchema,
  keepitCreateSchema,
  importOptionsSchema,
  validateField,
  validateObject
};

export default {
  validateParams,
  validateCompressionSettings,
  validateCompositionRequest,
  validateKeepitUpdate,
  validateKeepitCreate,
  validateImportOptions,
  validateFormatQuery,
  validatePagination,
  sanitizeRequestBody,
  sanitizeString
};
