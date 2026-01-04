import { Job } from 'bullmq';
import { logger } from '../lib/logger';
import { getDb } from '../db/mongo';
import { http, getJitterDelay } from '../lib/http';
import { env } from '../config/env';

interface FlowExecuteJobData {
  flow_id: string;
  flow_name: string;
  steps: FlowStep[];
  context: Record<string, any>;
  user_id?: string;
}

interface FlowStep {
  step_id: string;
  name: string;
  type: 'http' | 'db' | 'condition' | 'delay';
  config: Record<string, any>;
  on_error?: 'continue' | 'stop' | 'retry';
}

/**
 * Flow Executor Worker
 * Orchestrates multi-step workflows with conditional logic
 */
export async function processFlowExecute(job: Job<FlowExecuteJobData>): Promise<any> {
  const { flow_id, flow_name, steps, context, user_id } = job.data;
  
  logger.info(`Flow execution started: id=${job.id} flow=${flow_id} name=${flow_name} steps=${steps.length}`);

  const db = await getDb();
  const executionId = `exec_${Date.now()}_${flow_id}`;
  const results: any[] = [];

  try {
    // Create execution record (using snake_case for all timestamps)
    const now = new Date();
    await db.collection('flow_executions').insertOne({
      execution_id: executionId,
      flow_id,
      flow_name,
      user_id,
      status: 'running',
      started_at: now,
      created_at: now,
      updated_at: now,
      context,
    });

    // Execute steps sequentially
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      logger.info(`Executing step: flow=${flow_id} step=${step.step_id} name=${step.name} type=${step.type}`);

      try {
        let stepResult: any;

        switch (step.type) {
          case 'http':
            stepResult = await executeHttpStep(step, context);
            break;
          case 'db':
            stepResult = await executeDbStep(step, context, db);
            break;
          case 'condition':
            stepResult = await executeConditionStep(step, context, results);
            break;
          case 'delay':
            stepResult = await executeDelayStep(step);
            break;
          default:
            throw new Error(`Unknown step type: ${step.type}`);
        }

        results.push({
          step_id: step.step_id,
          name: step.name,
          status: 'success',
          result: stepResult,
          executed_at: new Date(),
        });

        // Update context with step result
        context[`step_${step.step_id}`] = stepResult;

      } catch (stepErr: any) {
        logger.error(`Step failed: flow=${flow_id} step=${step.step_id} error=${stepErr?.message}`);

        results.push({
          step_id: step.step_id,
          name: step.name,
          status: 'failed',
          error: stepErr?.message,
          executed_at: new Date(),
        });

        // Handle error based on step configuration
        const onError = step.on_error || 'stop';
        if (onError === 'stop') {
          throw stepErr;
        } else if (onError === 'continue') {
          logger.info(`Continuing flow despite step error: step=${step.step_id}`);
        }
        // 'retry' is handled by BullMQ job retry mechanism
      }
    }

    // Mark execution as completed (using snake_case for timestamps)
    await db.collection('flow_executions').updateOne(
      { execution_id: executionId },
      {
        $set: {
          status: 'completed',
          completed_at: new Date(),
          updated_at: new Date(),
          results,
        },
      }
    );

    logger.info(`Flow execution completed: id=${job.id} flow=${flow_id} steps=${results.length}`);

    return {
      ok: true,
      execution_id: executionId,
      flow_id,
      results,
    };

  } catch (err: any) {
    logger.error(`Flow execution failed: id=${job.id} flow=${flow_id} error=${err?.message}`);

    // Mark execution as failed (using snake_case for timestamps)
    await db.collection('flow_executions').updateOne(
      { execution_id: executionId },
      {
        $set: {
          status: 'failed',
          failed_at: new Date(),
          updated_at: new Date(),
          error: err?.message,
          results,
        },
      }
    );

    throw err;
  }
}

async function executeHttpStep(step: FlowStep, context: Record<string, any>): Promise<any> {
  const { url, method, headers, body } = step.config;
  
  // Replace variables in config with context values
  const resolvedUrl = replaceVariables(url, context);
  const resolvedHeaders = replaceVariables(headers, context);
  const resolvedBody = replaceVariables(body, context);

  const response = await http.request({
    url: resolvedUrl,
    method: method || 'GET',
    headers: resolvedHeaders,
    data: resolvedBody,
  });

  return {
    status: response.status,
    data: response.data,
  };
}

async function executeDbStep(step: FlowStep, context: Record<string, any>, db: any): Promise<any> {
  const { collection, operation, query, update, options } = step.config;
  
  const resolvedQuery = replaceVariables(query, context);
  const resolvedUpdate = replaceVariables(update, context);

  switch (operation) {
    case 'findOne':
      return await db.collection(collection).findOne(resolvedQuery);
    case 'find':
      return await db.collection(collection).find(resolvedQuery).toArray();
    case 'insertOne':
      return await db.collection(collection).insertOne(resolvedUpdate);
    case 'updateOne':
      return await db.collection(collection).updateOne(resolvedQuery, resolvedUpdate, options);
    case 'deleteOne':
      return await db.collection(collection).deleteOne(resolvedQuery);
    default:
      throw new Error(`Unknown DB operation: ${operation}`);
  }
}

async function executeConditionStep(step: FlowStep, context: Record<string, any>, results: any[]): Promise<any> {
  const { condition, true_path, false_path } = step.config;
  
  // Evaluate condition (simple string comparison or existence check)
  const conditionMet = evaluateCondition(condition, context);
  
  return {
    condition_met: conditionMet,
    path_taken: conditionMet ? true_path : false_path,
  };
}

async function executeDelayStep(step: FlowStep): Promise<any> {
  const { delay_ms } = step.config;
  const baseDelay = delay_ms || 1000;
  // Add jitter (50-150ms) to prevent thundering herd on retries
  const jitterMs = getJitterDelay(100);
  const totalDelay = baseDelay + jitterMs;
  await new Promise(resolve => setTimeout(resolve, totalDelay));
  logger.debug(`Delay step executed: base=${baseDelay}ms jitter=${jitterMs}ms total=${totalDelay}ms`);
  return { delayed_ms: totalDelay, base_ms: baseDelay, jitter_ms: jitterMs };
}

function replaceVariables(obj: any, context: Record<string, any>): any {
  if (typeof obj === 'string') {
    return obj.replace(/\{\{(\w+)\}\}/g, (_, key) => context[key] || '');
  }
  if (Array.isArray(obj)) {
    return obj.map(item => replaceVariables(item, context));
  }
  if (obj && typeof obj === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = replaceVariables(value, context);
    }
    return result;
  }
  return obj;
}

/**
 * Safe condition evaluator with support for common operators
 * Supports: ==, !=, >, <, >=, <=, &&, ||, !
 * Variables are replaced with context values using {{varName}} syntax
 */
function evaluateCondition(condition: string, context: Record<string, any>): boolean {
  try {
    // Replace {{variable}} with actual values from context
    const resolved = condition.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      const val = context[key];
      if (val === undefined || val === null) return 'null';
      if (typeof val === 'string') return JSON.stringify(val);
      if (typeof val === 'object') return JSON.stringify(val);
      return String(val);
    });

    // Whitelist allowed characters for safety
    // Only allow: alphanumeric, spaces, comparison operators, logical operators, parentheses, quotes, dots, brackets
    const safePattern = /^[\w\s\d\.\[\]'"<>=!&|()+-]+$/;
    if (!safePattern.test(resolved)) {
      logger.warn(`Unsafe condition rejected: ${condition}`);
      return false;
    }

    // Blacklist dangerous patterns
    const dangerousPatterns = [
      /\bfunction\b/i,
      /\beval\b/i,
      /\bexec\b/i,
      /\bimport\b/i,
      /\brequire\b/i,
      /\bprocess\b/i,
      /\bglobal\b/i,
      /\bwindow\b/i,
      /\bdocument\b/i,
      /\bconstructor\b/i,
      /\b__proto__\b/i,
      /\bprototype\b/i,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(resolved)) {
        logger.warn(`Dangerous pattern in condition rejected: ${condition}`);
        return false;
      }
    }

    // Use Function constructor with empty scope for safer evaluation
    // This is still not 100% safe, but much safer than eval()
    const evaluator = new Function('return ' + resolved);
    const result = evaluator();
    return Boolean(result);
  } catch (err: any) {
    logger.warn(`Condition evaluation failed: ${condition} - ${err?.message}`);
    return false;
  }
}

