import os
from typing import Optional
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from strands import Agent, tool
from strands.models import BedrockModel
from tavily import TavilyClient
from prompts.prompts import RESEARCH_FORMATTER_PROMPT, SIMPLE_SEARCH_PROMPT, SYSTEM_PROMPT
from prompts.utils import (
    format_crawl_results_for_agent,
    format_extract_results_for_agent,
    format_search_results_for_agent,
)
import uvicorn

# Define constants
RESEARCH_DIR = "research_findings"

load_dotenv()
if not os.getenv("TAVILY_API_KEY"):
    raise ValueError(
        "TAVILY_API_KEY environment variable is not set. Please add it to your .env file."
    )

tavily_client = TavilyClient(api_key=os.getenv("TAVILY_API_KEY"))
app = FastAPI(title="Web Search Agent")

# Add CORS middleware to allow cross-origin requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins
    allow_credentials=True,
    allow_methods=["*"],  # Allow all methods
    allow_headers=["*"],  # Allow all headers
)

@tool
def web_search(
    query: str,
    max_results: Optional[int] = 5,
    time_range: Optional[str] = None,
    include_domains: Optional[str] = None,
) -> str:
    """Perform a web search. Returns the search results as a string, with the title, url, and content of each result ranked by relevance.
    This tool conducts thorough web searches. The results will be ranked by semantic relevance and include title, url, and content.

    Args:
        query (str): The search query to be sent for the web search.
        max_results (Optional[int]): The maximum number of search results to return. For simple queries, 5 is recommended, for complex queries, 10 is recommended.
        time_range (Optional[str]): Limits results to content published within a specific timeframe.
            Valid values: 'd' (day - 24h), 'w' (week - 7d), 'm' (month - 30d), 'y' (year - 365d).
            Defaults to None.
        include_domains (Optional[str]): A list of domains to restrict search results to.
            Only results from these domains will be returned. Defaults to None.

    Returns:
        str: The formatted web search results
    """
    client = TavilyClient(api_key=os.getenv("TAVILY_API_KEY"))
    formatted_results = format_search_results_for_agent(
        client.get_search_context(
            query=query,  
            max_results=max_results,
            time_range=time_range,
            include_domains=include_domains,
        )
    )
    return formatted_results


@tool
def web_answer(
    query: str
) -> str:
    """Provides an answer to user's question using Web Search. Returns the answer as a String. The Result can be directly consumed as answer.

    Args:
        query (str): The search query to be sent for the web search.
    Returns:
        str: Response for the given query.
    """
    client = TavilyClient(api_key=os.getenv("TAVILY_API_KEY"))
    formatted_results=client.qna_search(
            query=query,  
    )
    return formatted_results


@tool
def web_extract(
    urls: str | list[str], include_images: bool = False, extract_depth: str = "basic"
) -> str:
    """Extract content from one or more web pages using Tavily's extract API.
    Args:
        urls (str | list[str]): A single URL string or a list of URLs to extract content from.
        include_images (bool, optional): Whether to also extract image URLs from the pages.
                                       Defaults to False.
        extract_depth (str, optional): The depth of extraction. 'basic' provides standard
                                     content extraction, 'advanced' provides more detailed
                                     extraction. Defaults to "basic".

    Returns:
        str: A formatted string containing the extracted content from each URL, including
             the full raw content, any images found (if requested), and information about
             any URLs that failed to be processed.
    """
    try:
        # Ensure urls is always a list for the API call
        if isinstance(urls, str):
            urls_list = [urls]
        else:
            urls_list = urls

        # Clean and validate URLs
        cleaned_urls = []
        for url in urls_list:
            if url.strip().startswith("{") and '"url":' in url:
                import re

                m = re.search(r'"url"\s*:\s*"([^"]+)"', url)
                if m:
                    url = m.group(1)

            if not url.startswith(("http://", "https://")):
                url = "https://" + url

            cleaned_urls.append(url)

        # Call Tavily extract API
        api_response = tavily_client.extract(
            urls=cleaned_urls,  # List of URLs to extract content from
            include_images=include_images,  # Whether to include image extraction
            extract_depth=extract_depth,  # Depth of extraction (basic or advanced)
        )

        # Format the results for the agent
        formatted_results = format_extract_results_for_agent(api_response)
        return formatted_results

    except Exception as e:
        return f"Error during extraction: {e}\nURLs attempted: {urls}\nFailed to extract content."


@tool
def format_research_response(
    research_content: str,
    format_style: Optional[str] = None,
    user_query: Optional[str] = None,
) -> str:
    """Format research content into a well-structured, properly cited response.
    The response will clearly address the user's query and present the research results in markdown format.

    Args:
        research_content (str): The raw research content to be formatted
        format_style (Optional[str]): Desired format style (e.g., "blog", "report",
                                    "executive summary", "bullet points", "direct answer")
        user_query (Optional[str]): Original user question to help determine appropriate format

    Returns:
        str: Professionally formatted research response with proper citations,
             clear structure, and appropriate style for the intended audience
    """
    # default_bedrock_model_id: str = "us.anthropic.claude-3-5-sonnet-20241022-v2:0"
    print("using format_research_response")
    try:
        bedrock_model = BedrockModel(
            model_id="us.anthropic.claude-3-5-sonnet-20241022-v2:0",
            region_name="us-east-1",
        )
        # Strands Agents SDK makes it easy to create a specialized agent
        formatter_agent = Agent(
            model=bedrock_model,
            system_prompt=RESEARCH_FORMATTER_PROMPT,
        )

        # Prepare the input for the formatter
        format_input = f"Research Content:\n{research_content}\n\n"

        if format_style:
            format_input += f"Requested Format Style: {format_style}\n\n"

        if user_query:
            format_input += f"Original User Query: {user_query}\n\n"

        format_input += "Please format this research content according to the guidelines and appropriate style."

        # Call the agent and return its response
        response = formatter_agent(format_input)
        return str(response)
    except Exception as e:
        return f"Error in research formatting: {str(e)}"


@tool
def web_crawl(url: str, instructions: Optional[str] = None) -> str:
    """
    Crawls a given URL, processes the results, and formats them into a string.
    This tool conducts deep web crawls that find all nested links from a single page.
    This is great for finding all the information that is linked from a specific webpage.

    Args:
        url (str): The URL of the website to crawl.
        instructions (Optional[str]): Specific instructions to guide the
                                     Tavily crawler, such as focusing on
                                     certain types of content or avoiding
                                     others. Defaults to None.

    Returns:
        str: A formatted string containing the crawl results. Each result includes
             the URL and a snippet of the page content.
             If an error occurs during the crawl process (e.g., network issue,
             API error), a string detailing the error and the attempted URL is
             returned.
    """
    max_depth = 2
    limit = 20

    if url.strip().startswith("{") and '"url":' in url:
        import re

        m = re.search(r'"url"\s*:\s*"([^"]+)"', url)
        if m:
            url = m.group(1)

    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    try:
        # Crawls the web using Tavily API
        api_response = tavily_client.crawl(
            url=url,  # The URL to crawl
            max_depth=max_depth,  # Defines how far from the base URL the crawler can explore
            limit=limit,  # Limits the number of results returned
            instructions=instructions,  # Optional instructions for the crawler
        )

        tavily_results = (
            api_response.get("results")
            if isinstance(api_response, dict)
            else api_response
        )

        formatted = format_crawl_results_for_agent(tavily_results)
        return formatted
    except Exception as e:
        return f"Error: {e}\n" f"URL attempted: {url}\n" "Failed to crawl the website."


deep_research_web_agent = Agent(
    system_prompt=SYSTEM_PROMPT,
    tools=[
        web_search,
        web_crawl,
        web_extract,
        format_research_response,
    ],
)

simple_web_agent = Agent(
    system_prompt=SIMPLE_SEARCH_PROMPT,
    tools=[
        web_search,
        web_answer
    ],
)

@app.get('/')
def health_check():
    """
    Default endpoint.
    
    Returns:
        dict: A status message
    """
    return {"status": "healthy"}

@app.get('/health')
def health_check():
    """
    Health check endpoint for the load balancer.
    
    Returns:
        dict: A status message indicating the service is ?promy
    """
    return {"status": "healthy"}

@app.get('/simple-search')
async def search(prompt: str):
    """
    Search endpoint that accepts a prompt parameter, does a websearch based on the prompt and returns a streaming response

    Args:
        prompt (str): The prompt parameter from the query string
        promptId (str, optional): Optional promptId parameter
        sessionId (str, optional): Optional sessionId parameter

     Returns:
        StreamingResponse: A streaming response of the web search results

    Raises:
        HTTPException: If the request is invalid or if an error occurs
    """
    try:
        print(f"Searching the web for {prompt}")
        if not prompt:
            raise HTTPException(status_code=400, detail="No prompt provided")

        return StreamingResponse(
            stream_web_search_response(simple_web_agent, prompt),
            media_type="text/plain"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get('/deep-search')
async def search(prompt: str):
    """
    Search endpoint that accepts a prompt parameter, does a websearch based on the prompt and returns a streaming response
    
    Args:
        prompt (str): The prompt parameter from the query string
     Returns:
        StreamingResponse: A streaming response of the web search results
        
    Raises:
        HTTPException: If the request is invalid or if an error occurs
    """
    try:
        print(f"Searching the web for {prompt}")
        if not prompt:
            raise HTTPException(status_code=400, detail="No prompt provided")

        # Add CORS headers to ensure streaming works across domains
        headers = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        }
        
        return StreamingResponse(
            stream_web_search_response(deep_research_web_agent, prompt),
            media_type="text/plain",
            headers=headers
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
    
async def stream_web_search_response(agent, prompt: str):
    """
    Run the web search assistant and stream the response.
    
    Args:
        agent: The agent instance to use
        prompt (str): The user's prompt

    Yields:
        str: Chunks of the response as they become available
    """
    try:
        # Debug message to confirm streaming has started
        yield "Starting search...\n"
        
        # Stream the response
        async for item in agent.stream_async(prompt):
            # Debug the structure of each item
            item_type = str(type(item))
            yield f"\n[DEBUG: Received item of type {item_type}]\n"
            
            if "message" in item and "content" in item["message"] and "role" in item["message"] and item["message"]["role"] == "assistant":
                yield f"\n[DEBUG: Found assistant message with content]\n"
                
                for content_item in item['message']['content']:
                    # Debug the content item structure
                    content_keys = str(content_item.keys())
                    yield f"\n[DEBUG: Content item keys: {content_keys}]\n"
                    
                    if "text" in content_item:
                        # Stream the actual text content
                        yield f"\n[DEBUG: Found text content: {content_item['text'][:30]}...]\n"
                        yield content_item["text"]
                    elif "toolUse" in content_item and "name" in content_item["toolUse"]:
                        yield f"\n[Using tool: {content_item['toolUse']['name']}]\n"
                        yield f"    \n[{content_item}]\n"
            elif "data" in item:
                yield f"\n[DEBUG: Found data item]\n"
                yield item['data']
            else:
                yield f"\n[DEBUG: Unhandled item: {str(item)[:100]}...]\n"
    except Exception as e:
        yield f"\nError during streaming: {str(e)}"

if __name__ == "__main__":
    port = int(os.environ.get('PORT', 8000))
    print(f"Starting Agent Websearch on port {port}")
    uvicorn.run(
        app, 
        host='0.0.0.0', 
        port=port,
        log_level="info",  # Enable debug logging
        timeout_keep_alive=0,  # Disable keep-alive timeout
        timeout_graceful_shutdown=1,  # Quick shutdown
        limit_concurrency=10,  # Limit concurrent connections
    )
