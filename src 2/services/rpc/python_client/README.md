# KAIROS Python RPC Client

`kairos_tools.py` lets a local Python script call Claude Code tools over the
KAIROS Unix socket without spending a Claude turn per tool call.

## Environment

`RunScriptTool` injects both variables automatically:

- `KAIROS_SOCKET`
- `KAIROS_TOKEN`

## Example

```python
from kairos_tools import call

result = call("ReadFile", {"path": "/tmp/example.txt"})
print(result)
```

## Reusing One Connection

```python
from kairos_tools import KairosToolsClient

with KairosToolsClient() as client:
    tools = client.list_tools()
    print(tools)
    print(client.call("ReadFile", {"path": "/tmp/example.txt"}))
```

