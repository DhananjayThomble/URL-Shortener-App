import { CognitoIdentityProviderClient, AdminCreateUserCommand, AdminSetUserPasswordCommand, AdminInitiateAuthCommand, AdminGetUserCommand } from "@aws-sdk/client-cognito-identity-provider";

const cognitoClient = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION || 'us-east-1'
});

/**
 * Cognito authentication helper functions
 */
export class CognitoHelper {
  constructor(userPoolId, clientId) {
    this.userPoolId = userPoolId;
    this.clientId = clientId;
  }

  async createUser(email, temporaryPassword, name) {
    const command = new AdminCreateUserCommand({
      UserPoolId: this.userPoolId,
      Username: email,
      TemporaryPassword: temporaryPassword,
      UserAttributes: [
        {
          Name: 'email',
          Value: email
        },
        {
          Name: 'name',
          Value: name
        },
        {
          Name: 'email_verified',
          Value: 'true'
        }
      ],
      MessageAction: 'SUPPRESS'
    });

    return await cognitoClient.send(command);
  }

  async setUserPassword(username, password, permanent = true) {
    const command = new AdminSetUserPasswordCommand({
      UserPoolId: this.userPoolId,
      Username: username,
      Password: password,
      Permanent: permanent
    });

    return await cognitoClient.send(command);
  }

  async authenticateUser(username, password) {
    const command = new AdminInitiateAuthCommand({
      UserPoolId: this.userPoolId,
      ClientId: this.clientId,
      AuthFlow: 'ADMIN_NO_SRP_AUTH',
      AuthParameters: {
        USERNAME: username,
        PASSWORD: password
      }
    });

    return await cognitoClient.send(command);
  }

  async getUser(username) {
    const command = new AdminGetUserCommand({
      UserPoolId: this.userPoolId,
      Username: username
    });

    return await cognitoClient.send(command);
  }
}

/**
 * Extract user information from Cognito JWT token
 */
export function extractUserFromToken(token) {
  try {
    // Decode JWT token (in production, you should verify the signature)
    const base64Payload = token.split('.')[1];
    const payload = Buffer.from(base64Payload, 'base64').toString();
    return JSON.parse(payload);
  } catch (error) {
    throw new Error('Invalid token format');
  }
}