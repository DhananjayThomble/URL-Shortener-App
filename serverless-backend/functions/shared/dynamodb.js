import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand, DeleteCommand, QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1'
});

const ddbDocClient = DynamoDBDocumentClient.from(client);

/**
 * DynamoDB utility functions for SnapURL serverless backend
 */
export class DynamoDBHelper {
  constructor(tableName) {
    this.tableName = tableName;
  }

  async create(item) {
    const command = new PutCommand({
      TableName: this.tableName,
      Item: {
        ...item,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    });
    return await ddbDocClient.send(command);
  }

  async get(key) {
    const command = new GetCommand({
      TableName: this.tableName,
      Key: key
    });
    const result = await ddbDocClient.send(command);
    return result.Item;
  }

  async update(key, updateExpression, expressionAttributeValues, expressionAttributeNames = {}) {
    const command = new UpdateCommand({
      TableName: this.tableName,
      Key: key,
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: {
        ...expressionAttributeValues,
        ':updatedAt': new Date().toISOString()
      },
      ExpressionAttributeNames: expressionAttributeNames,
      ReturnValues: 'ALL_NEW'
    });
    const result = await ddbDocClient.send(command);
    return result.Attributes;
  }

  async delete(key) {
    const command = new DeleteCommand({
      TableName: this.tableName,
      Key: key
    });
    return await ddbDocClient.send(command);
  }

  async query(keyConditionExpression, expressionAttributeValues, indexName = null) {
    const command = new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: keyConditionExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      ...(indexName && { IndexName: indexName })
    });
    const result = await ddbDocClient.send(command);
    return result.Items;
  }

  async scan(filterExpression = null, expressionAttributeValues = {}) {
    const command = new ScanCommand({
      TableName: this.tableName,
      ...(filterExpression && { FilterExpression: filterExpression }),
      ...(Object.keys(expressionAttributeValues).length > 0 && { ExpressionAttributeValues: expressionAttributeValues })
    });
    const result = await ddbDocClient.send(command);
    return result.Items;
  }
}

/**
 * Generate UUID for DynamoDB items
 */
export function generateId() {
  return crypto.randomUUID();
}

/**
 * Create standard API response
 */
export function createResponse(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      ...headers
    },
    body: JSON.stringify(body)
  };
}

/**
 * Parse JSON body from Lambda event
 */
export function parseBody(event) {
  try {
    return JSON.parse(event.body || '{}');
  } catch (error) {
    throw new Error('Invalid JSON in request body');
  }
}

/**
 * Extract JWT token from Authorization header
 */
export function extractToken(event) {
  const authHeader = event.headers?.Authorization || event.headers?.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('No valid authorization token provided');
  }
  return authHeader.substring(7);
}

/**
 * Validate required fields in request body
 */
export function validateRequiredFields(body, requiredFields) {
  const missingFields = requiredFields.filter(field => !body[field]);
  if (missingFields.length > 0) {
    throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
  }
}

/**
 * Validate email format
 */
export function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate URL format
 */
export function validateUrl(url) {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}