#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import {AgentStack} from '../lib/agent-stack';
import {PluginStack} from '../lib/plugin-stack';
import {ConfigLoader} from "../config/config-loader";

const app = new cdk.App();

// Get both the new hierarchical config and the legacy flattened config
const configLoader = ConfigLoader.getInstance();
const appConfig = configLoader.getAppConfig();

const agentStack = new AgentStack(app, 'AgentStack', {
    projectName: appConfig.projectName,
    https: appConfig.https,
    tavilyApiKey: appConfig.tavilyApiKey,
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION
    },
});

const pluginStack = new PluginStack(app, 'PluginStack', {
    appConfig: appConfig,
    agentUrl: agentStack.agentUrl,
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION
    },
});

pluginStack.addDependency(agentStack)
