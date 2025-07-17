# Web Search Agent Plugin for Amazon Q Business - Simplified Architecture

```mermaid
flowchart TB
    %% Main components
    User((User)) --> QBusiness[Amazon Q Business]
    QBusiness <--> Plugin[Web Search Plugin]
    Plugin <--> Agent[Web Search Agent]
    Agent <--> TavilyAPI[Tavily Search API]
    Agent <--> Bedrock[AWS Bedrock\nClaude 3.5 Sonnet]
    
    %% AWS Infrastructure
    subgraph AWS Cloud
        subgraph "Amazon Q Business"
            QBusiness
            Plugin
        end
        
        subgraph "Agent Infrastructure"
            ALB[Application Load Balancer]
            
            subgraph "ECS Fargate"
                Agent
                SimpleSearch[Simple Search]
                DeepSearch[Deep Search]
                
                Agent --> SimpleSearch
                Agent --> DeepSearch
            end
            
            ALB --> Agent
        end
        
        Plugin --> ALB
        
        subgraph "Security & Authentication"
            OAuth[OAuth2]
            SecretsManager[(Secrets Manager)]
            IAM[IAM Roles]
            
            Plugin --> OAuth
            OAuth --> SecretsManager
        end
        
        Bedrock
    end
    
    %% External Services
    subgraph "External Services"
        TavilyAPI
        Internet[Internet\nWeb Content]
        
        TavilyAPI <--> Internet
    end
    
    %% Styling
    classDef aws fill:#FF9900,stroke:#232F3E,color:#232F3E
    classDef agent fill:#009688,stroke:#00796B,color:white
    classDef external fill:#3F51B5,stroke:#303F9F,color:white
    classDef user fill:#9C27B0,stroke:#7B1FA2,color:white
    
    class ALB,SecretsManager,Bedrock,IAM,OAuth aws
    class Agent,SimpleSearch,DeepSearch agent
    class TavilyAPI,Internet external
    class User user
```

## Key Components

1. **User & Amazon Q Business**
   - Users interact with Amazon Q Business chat interface
   - Q Business determines when web search is needed

2. **Web Search Plugin**
   - Integrates with Amazon Q Business
   - Uses OAuth2 for authentication
   - Communicates with the Web Search Agent via API

3. **Web Search Agent**
   - Deployed as containerized service on ECS Fargate
   - Provides two search capabilities:
     - **Simple Search**: Basic web search and direct answers
     - **Deep Search**: Comprehensive research with crawling and extraction

4. **External Services**
   - **Tavily Search API**: Provides web search, crawling, and extraction capabilities
   - **AWS Bedrock**: Provides LLM capabilities via Claude 3.5 Sonnet

5. **Security & Infrastructure**
   - **OAuth2**: Secures plugin access
   - **Secrets Manager**: Stores authentication credentials
   - **IAM Roles**: Controls access to AWS resources
   - **Application Load Balancer**: Routes traffic to the agent service

## Data Flow

1. User asks a question in Amazon Q Business
2. Q Business determines web search is needed and invokes the plugin
3. Plugin authenticates and calls the Web Search Agent API
4. Agent performs web search using Tavily API
5. For complex queries, agent uses additional tools (crawl, extract)
6. Results are processed using Claude 3.5 Sonnet
7. Formatted response is returned to Q Business and displayed to user
