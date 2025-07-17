import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import {AppConfig, LegacyAppConfig} from "./types";

export class ConfigLoader {
    private static instance: ConfigLoader;
    public config: AppConfig;

    private constructor() {
        this.config = this.loadConfig();
    }

    public static getInstance(): ConfigLoader {
        if (!ConfigLoader.instance) {
            ConfigLoader.instance = new ConfigLoader();
        }
        return ConfigLoader.instance;
    }

    private loadConfig(): AppConfig {
        try {
            const configPath = path.join(process.cwd(), 'config.yaml');
            const fileContents = fs.readFileSync(configPath, 'utf8');
            return yaml.load(fileContents) as AppConfig;
        } catch (error) {
            throw new Error(`Failed to load config.yaml: ${error}`);
        }
    }

    public getAppConfig(): AppConfig{
        return this.config;
    }

    /**
     * Converts the new hierarchical AppConfig structure to the legacy flattened structure
     * for backward compatibility with existing code.
     * 
     * @returns LegacyAppConfig - A flattened version of the configuration
     */
    public getLegacyAppConfig(): LegacyAppConfig {
        return {
            tokenUrl: this.config.plugin.tokenUrl,
            authorizationUrl: this.config.plugin.authorizationUrl,
            scopes: this.config.plugin.scopes,
            redirectUri: this.config.plugin.secrets.redirectUri,
            clientId: this.config.plugin.secrets.clientId,
            clientSecret: this.config.plugin.secrets.clientSecret
        };
    }
}
