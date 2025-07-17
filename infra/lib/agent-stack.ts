import * as cdk from "aws-cdk-lib";
import {Construct} from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ecrAssets from "aws-cdk-lib/aws-ecr-assets";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as path from "path";
import {Duration, StackProps} from "aws-cdk-lib";
import {Https} from "../config/types";

export interface AgentStackProps extends StackProps {
    projectName: string
    https?: Https;
    tavilyApiKey: string
}

export class AgentStack extends cdk.Stack {
    agentUrl: string;
    constructor(scope: Construct, id: string, props: AgentStackProps) {
        super(scope, id, props);

        // // Add a new parameter for max response size in bytes
        const maxResponseSize = new cdk.CfnParameter(this, "MaxResponseSize", {
            type: "Number",
            description: "Maximum size for row query results in bytes",
            default: 25600, // 25K default
        });

        // // Add new parameters for Fargate task configuration
        const taskCpu = new cdk.CfnParameter(this, "TaskCpu", {
            type: "Number",
            description:
                "CPU units for Fargate task (256=0.25vCPU, 512=0.5vCPU, 1024=1vCPU, 2048=2vCPU, 4096=4vCPU)",
            default: 2048,
        });

        const taskMemory = new cdk.CfnParameter(this, "TaskMemory", {
            type: "Number",
            description: "Memory (in MiB) for Fargate task",
            default: 4096,
        });

        const serviceDesiredCount = new cdk.CfnParameter(
            this,
            "ServiceDesiredCount",
            {
                type: "Number",
                description: "Desired count of tasks for the Fargate service",
                default: 1,
                minValue: 1,
                maxValue: 10,
            }
        );

        const vpc = new ec2.Vpc(this, "WebSearchVpc", {
            vpcName: `${props.projectName}-vpc`,
            ipAddresses: ec2.IpAddresses.cidr("10.0.0.0/21"),
            maxAzs: 3,
            natGateways: 1,
            subnetConfiguration: [
                {
                    subnetType: ec2.SubnetType.PUBLIC,
                    name: "Ingress",
                    cidrMask: 24,
                },
                {
                    cidrMask: 24,
                    name: "Private",
                    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
                },
            ],
        });

        // Keep only gateway endpoints, removing all interface endpoints
        vpc.addGatewayEndpoint("S3Endpoint", {
            service: ec2.GatewayVpcEndpointAwsService.S3,
            subnets: [{subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS}],
        });

        // =================== FARGATE SERVICE SETUP ===================
        // Create ECS Cluster
        const ecsCluster = new ecs.Cluster(this, "AgentCluster", {
            vpc: vpc,
            clusterName: `${props.projectName}-cluster`,
            containerInsightsV2: ecs.ContainerInsights.ENHANCED,
        });

        // Create log group for Fargate service
        const logGroup = new logs.LogGroup(this, "AgentLogGroup", {
            logGroupName: `/ecs/${props.projectName}-service`,
            retention: logs.RetentionDays.ONE_MONTH,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        // Create execution role for Fargate task
        const executionRole = new iam.Role(this, "AgentTaskExecutionRole", {
            assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
            roleName: `${props.projectName}-task-execution-role`,
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName(
                    "service-role/AmazonECSTaskExecutionRolePolicy"
                ),
            ],
        });

        // Create task role for Fargate task
        const taskRole = new iam.Role(this, "AgentTaskRole", {
            assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
            roleName: `${props.projectName}-task-role`,
        });

        // Add Bedrock permissions to task role
        taskRole.addToPolicy(
            new iam.PolicyStatement({
                actions: [
                    "bedrock:InvokeModel",
                    "bedrock:InvokeModelWithResponseStream",
                ],
                resources: ["*"],
            })
        );

        // Create a task definition with parameterized CPU and memory
        const taskDefinition = new ecs.FargateTaskDefinition(
            this,
            "AgentTaskDefinition",
            {
                memoryLimitMiB: taskMemory.valueAsNumber,
                cpu: taskCpu.valueAsNumber,
                executionRole,
                taskRole,
                runtimePlatform: {
                    cpuArchitecture: ecs.CpuArchitecture.ARM64,
                    operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
                },
            }
        );

        // This will use the Dockerfile in the docker directory
        const dockerAsset = new ecrAssets.DockerImageAsset(this, "AgentImage", {
            directory: path.join(__dirname, "../../agents/web-search"),
            file: "./Dockerfile",
            platform: ecrAssets.Platform.LINUX_ARM64,
        });

        // Define the container port
        const containerPort = 8000;

        // Add container to the task definition
        const container = taskDefinition.addContainer("AgentContainer", {
            image: ecs.ContainerImage.fromDockerImageAsset(dockerAsset),
            logging: ecs.LogDrivers.awsLogs({
                streamPrefix: "agent-service",
                logGroup,
            }),
            environment: {
                AWS_REGION: process.env.CDK_DEFAULT_REGION!,
                MAX_RESPONSE_SIZE_BYTES: maxResponseSize.valueAsString,
                TAVILY_API_KEY: props.tavilyApiKey
            },
            portMappings: [
                {
                    containerPort: containerPort,
                    hostPort: containerPort,
                    protocol: ecs.Protocol.TCP,
                },
            ],
        });

        // Create a security group for the Fargate service
        const agentServiceSG = new ec2.SecurityGroup(this, "AgentServiceSG", {
            vpc,
            description: "Security group for Agent Fargate Service",
            allowAllOutbound: true,
        });

        // Create a Fargate service with parameterized desired count
        const service = new ecs.FargateService(this, "AgentService", {
            cluster: ecsCluster,
            taskDefinition,
            desiredCount: serviceDesiredCount.valueAsNumber,
            assignPublicIp: false,
            vpcSubnets: {subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS},
            circuitBreaker: {
                rollback: true,
            },
            securityGroups: [agentServiceSG],
            minHealthyPercent: 100,
            maxHealthyPercent: 200,
            healthCheckGracePeriod: Duration.seconds(60),
        });

        // =================== ADD APPLICATION LOAD BALANCER ===================

        // Create a security group for the ALB
        const albSG = new ec2.SecurityGroup(this, "AlbSecurityGroup", {
            vpc,
            description: "Security group for Agent Application Load Balancer",
            allowAllOutbound: true,
        });

        // Allow inbound HTTP traffic to the ALB on port 80
        albSG.addIngressRule(
            ec2.Peer.anyIpv4(),
            ec2.Port.tcp(80),
            "Allow HTTP traffic on port 80 from anywhere"
        );

        // Allow inbound HTTPS traffic to the ALB on port 443
        albSG.addIngressRule(
            ec2.Peer.anyIpv4(),
            ec2.Port.tcp(443),
            "Allow HTTPS traffic on port 443 from anywhere"
        );

        // Allow the ALB to communicate with the Fargate service
        agentServiceSG.addIngressRule(
            albSG,
            ec2.Port.tcp(containerPort),
            `Allow traffic from ALB to Fargate service on port ${containerPort}`
        );

        // Create an Application Load Balancer
        const lb = new elbv2.ApplicationLoadBalancer(this, "AgentLB", {
            vpc,
            internetFacing: true,
            securityGroup: albSG,
        });

        // Check if a certificate ARN was provided
        if (props.https) {
            // Import the existing certificate
            const cert = acm.Certificate.fromCertificateArn(
                this,
                "ImportedCertificate",
                props.https.certificateArn
            );

            // Create HTTPS listener with the provided certificate
            const httpsListener = lb.addListener("AgentHttpsListener", {
                port: 443,
                protocol: elbv2.ApplicationProtocol.HTTPS,
                certificates: [cert],
                sslPolicy: elbv2.SslPolicy.RECOMMENDED,
            });

            // Add target group to the HTTPS listener
            httpsListener.addTargets("AgentHttpsTargets", {
                port: containerPort,
                targets: [service],
                healthCheck: {
                    path: "/health",
                    interval: Duration.seconds(30),
                    timeout: Duration.seconds(5),
                    healthyHttpCodes: "200",
                },
                deregistrationDelay: Duration.seconds(30),
            });

            // Create HTTP listener that redirects to HTTPS
            const httpListener = lb.addListener("AgentHttpListener", {
                port: 80,
                defaultAction: elbv2.ListenerAction.redirect({
                    protocol: "HTTPS",
                    port: "443",
                    host: "#{host}",
                    path: "/#{path}",
                    query: "#{query}",
                }),
            });
        } else {
            // If no certificate ARN was provided, create an HTTP listener only
            const httpListener = lb.addListener("AgentHttpListener", {
                port: 80,
            });

            // Add target group to the HTTP listener
            httpListener.addTargets("AgentHttpTargets", {
                port: containerPort,
                targets: [service],
                healthCheck: {
                    path: "/health",
                    interval: Duration.seconds(30),
                    timeout: Duration.seconds(5),
                    healthyHttpCodes: "200",
                },
                deregistrationDelay: Duration.seconds(30),
            });
        }


        new cdk.CfnOutput(this, "AgentEndpointURL", {
            value: lb.loadBalancerDnsName,
            description: "The DNS name of the Application Load Balancer for the Strands Agent",
            exportName: `${props.projectName}-LoadBalancerDnsName`,
        });

        // Output the appropriate URL based on whether HTTPS is enabled
        if (props.https) {
            new cdk.CfnOutput(this, "WebSearchAgentUrl", {
                value: `https://${lb.loadBalancerDnsName}`,
                description: "The HTTPS URL of the Application Load Balancer for the Strands Agent",
                exportName: `${props.projectName}-load-balancer-url`,
            });
            this.agentUrl = `https://${props.https.fullyQualifiedUrl}`
        } else {
            new cdk.CfnOutput(this, "AgentHttpEndpointURL", {
                value: `http://${lb.loadBalancerDnsName}`,
                description: "The HTTP URL of the Application Load Balancer for the Strands Agent",
                exportName: `${props.projectName}-load-balancer-url`,
            });
            this.agentUrl = `http://${lb.loadBalancerDnsName}`
        }
    }
}
