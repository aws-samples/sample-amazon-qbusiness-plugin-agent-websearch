import * as cdk from "aws-cdk-lib";
import {Construct} from "constructs";
import * as yaml from "js-yaml";
import * as path from "node:path";
import * as fs from "node:fs";
import * as qbusiness from "aws-cdk-lib/aws-qbusiness";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as iam from "aws-cdk-lib/aws-iam";
import {CfnPlugin} from "aws-cdk-lib/aws-qbusiness";
import OAuth2ClientCredentialConfigurationProperty = CfnPlugin.OAuth2ClientCredentialConfigurationProperty;
import {AppConfig} from "../config/types";

export interface PluginStackProps extends cdk.StackProps {
    appConfig: AppConfig;
    agentUrl: string;
}

export class PluginStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: PluginStackProps) {
        super(scope, id, props);

        // Create a Secret Manager entry with Cognito configuration values
        const authorizationSecret = new secretsmanager.Secret(this, 'AuthorizationSecret', {
            description: 'Plugin Secret for authorization',
            secretName: `${props.appConfig.projectName}-Plugin-Secret`,
            generateSecretString: {
                secretStringTemplate: JSON.stringify({
                    client_id: props.appConfig.plugin.secrets.clientId,
                    client_secret: props.appConfig.plugin.secrets.clientSecret,
                    redirect_uri: props.appConfig.plugin.secrets.redirectUri,
                }),
                generateStringKey: 'dummy', // This key is not used but required by the API
            }
        });

        // Create a role with read access to the authorization secret
        const pluginRole = new iam.Role(this, 'PluginRole', {
            roleName: `${props.appConfig.projectName}-plugin-role`,
            assumedBy: new iam.ServicePrincipal('qbusiness.amazonaws.com'),
            description: 'Role for QBusiness plugin with read access to authorization secret',
            // Add inline policy directly during role creation
            inlinePolicies: {
                'SecretsManagerReadAccess': new iam.PolicyDocument({
                    statements: [
                        new iam.PolicyStatement({
                            actions: [
                                'secretsmanager:GetSecretValue',
                                'secretsmanager:DescribeSecret'
                            ],
                            resources: [authorizationSecret.secretArn],
                            effect: iam.Effect.ALLOW
                        })
                    ]
                })
            }
        });

        // Add resource policy to the secret to allow the role to access it
        const secretResourcePolicy = new secretsmanager.CfnResourcePolicy(this, 'SecretResourcePolicy', {
            secretId: authorizationSecret.secretArn,
            resourcePolicy: {
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Allow',
                    Principal: {
                        AWS: pluginRole.roleArn
                    },
                    Action: 'secretsmanager:GetSecretValue',
                    Resource: '*'
                }]
            }
        });
        
        // Ensure the resource policy is created after the secret
        secretResourcePolicy.addDependsOn(authorizationSecret.node.defaultChild as cdk.CfnResource);

        const oauthConfig = this.createOauthConfiguration(authorizationSecret.secretArn, pluginRole.roleArn, props)

        const plugin = this.createQBusinessPlugin(props.appConfig.qbusiness.applicationId, props.agentUrl, props.appConfig, oauthConfig);
    }

    private createOauthConfiguration(secretArn: string, roleArn: string, props: PluginStackProps): OAuth2ClientCredentialConfigurationProperty {
        return {
            tokenUrl: props.appConfig.plugin.tokenUrl,
            authorizationUrl: props.appConfig.plugin.authorizationUrl,
            secretArn: secretArn,
            roleArn: roleArn
        }
    }

    private createQBusinessPlugin(qbusinessApplicationId: string, webSearchAgentUrl: string, appConfig: AppConfig, oauthConfig: OAuth2ClientCredentialConfigurationProperty): qbusiness.CfnPlugin {
        const schemaPath = path.join(__dirname, 'web-search-spec.yaml');
        const schema = yaml.load(fs.readFileSync(schemaPath, 'utf8')) as Record<string, any>;
        schema.servers = [{
            url: webSearchAgentUrl,
            description: 'ALB for Web Search Agent'
        }];

        schema.components.securitySchemes = {
            oauth2: {
                type: 'oauth2',
                description: 'Auth2 Authorization Code flow for authentication',
                flows: {
                    authorizationCode: {
                        authorizationUrl: appConfig.plugin.authorizationUrl,
                        tokenUrl: appConfig.plugin.tokenUrl,
                        scopes: {
                            [appConfig.plugin.scopes]: "Access to web search functionality"
                        }
                    }
                }
            }
        }
        
        // Update security for all paths to use the scope from appConfig.plugin.scopes
        for (const pathKey in schema.paths) {
            const pathObj = schema.paths[pathKey];
            for (const methodKey in pathObj) {
                if (methodKey !== 'parameters') { // Skip parameters section
                    const methodObj = pathObj[methodKey];
                    methodObj.security = [
                        {
                            oauth2: [appConfig.plugin.scopes]
                        }
                    ];
                }
            }
        }
        
        // Write the updated schema to a new file
        const schemaDir = path.dirname(schemaPath);
        const updatedSchemaPath = path.join(schemaDir, 'web-search-spec-updated.yaml');
        fs.writeFileSync(updatedSchemaPath, yaml.dump(schema), 'utf8');
        console.log(`Updated schema written to ${updatedSchemaPath}`);

        return new qbusiness.CfnPlugin(this, 'WebSearchAgentPlugin', {
            applicationId: qbusinessApplicationId,
            type: 'CUSTOM',
            displayName: 'websearch-plugin',
            authConfiguration: {
                oAuth2ClientCredentialConfiguration: oauthConfig
            },
            customPluginConfiguration: {
                apiSchemaType: 'OPEN_API_V3',
                apiSchema: {
                    payload: yaml.dump(schema)
                },
                description: 'Custom plugin for Sharepoint integration with Amazon Q Business'
            }
        });
    }
}
