/**
 * QBusiness configuration
 */
export interface QBusinessConfig {
    applicationId: string;
}

/**
 * Plugin secrets configuration
 */
export interface PluginSecrets {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
}

/**
 * Plugin configuration
 */
export interface PluginConfig {
    tokenUrl: string;
    authorizationUrl: string;
    scopes: string;
    secrets: PluginSecrets;
}

export interface Https {
    certificateArn: string;
    fullyQualifiedUrl: string
}
/**
 * Complete application configuration
 */
export interface AppConfig {
    projectName: string;
    qbusiness: QBusinessConfig;
    https?: Https;
    plugin: PluginConfig;
    tavilyApiKey: string;
}

/**
 * Legacy flattened configuration (for backward compatibility)
 */
export interface LegacyAppConfig {
    tokenUrl: string;
    authorizationUrl: string;
    scopes: string;
    redirectUri: string;
    clientId: string;
    clientSecret: string;
}
