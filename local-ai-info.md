Connect to my LAN-hosted OpenAI-compatible local model.
Base URL: http://192.168.88.18:8081/v1
Model ID: ornith-1.5-35b-a3b
API type: OpenAI Chat Completions
API key: no authentication; use "local" if the client requires a value
Context window: 170000 tokens
Max output: 8192 tokens
Thinking level: high
Input: text
Tool calling: supported
Health endpoint:
http://192.168.88.18:8081/health
The model loads automatically on the first request and may take roughly
8–20 seconds when cold. It unloads after 10 minutes of inactivity.
Subsequent requests are much faster because the prompt cache is reused.
Example request:
curl http://192.168.88.18:8081/v1/chat/completions \
 -H "Content-Type: application/json" \
 -d '{
"model": "ornith-1.5-35b-a3b",
"messages": [
{"role": "user", "content": "Reply only with CONNECTED"}
],
"max_tokens": 128
}'
