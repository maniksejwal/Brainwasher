# Llama 4 Integration Guide

This guide explains how to use the Llama 4 SageMaker endpoint in your applications.

## Quick Start

### 1. Using the Provider Layer (Recommended)

The Llama 4 endpoint is integrated into the llm_providers framework:

```python
from llm_providers.factory import get_llm_provider

# Get the SageMaker provider
provider = get_llm_provider("sagemaker")

# Generate content
response = provider.generate_content(
    model="llama4",  # or "sagemaker" 
    contents=["What are the symptoms of diabetes?"]
)
print(response)
```

### 2. Direct SageMaker Invocation

For direct access without the provider layer:

```python
import boto3
import json

client = boto3.client("sagemaker-runtime", region_name="ap-south-1")

payload = {
    "prompt": "What are the symptoms of diabetes?",
    "max_new_tokens": 256,
    "temperature": 0.2
}

response = client.invoke_endpoint(
    EndpointName="emm-llama4-dev",
    ContentType="application/json",
    Body=json.dumps(payload)
)

result = json.loads(response["Body"].read().decode("utf-8"))
print(result["generated_text"])
```

## Configuration

### Environment Variables
- `LLAMA4_ENDPOINT_NAME`: SageMaker endpoint name (default: emm-llama4-dev)
- `AWS_REGION`: AWS region (default: ap-south-1)

### Model Routing

The `config.py` auto-routes models containing "llama" or "sagemaker" to the SageMaker provider:

```python
from prescriptions.services.config import generate_content

# Automatically uses SageMaker provider
response = generate_content(
    model="llama4",
    contents=["Your prompt here"]
)
```

## Benchmarking

### Simple Performance Test
```bash
cd d:\Projects\MMT\EMM
python benchmark-llama4.py
```

### Pipeline Integration Test

To test Llama 4 within the full ICD extraction pipeline:

```bash
cd "d:\Projects\MMT\EMM\Agents server (e-px-django)"
python -m benchmarks.run_agents \
    --dataset "d:\Projects\MMT\EMM\data\demo\case1" \
    --agents icd \
    --model llama4 \
    --icd-version "v2.x_sagemaker_light_noreasoning"
```

**Note:** The default v2.0 uses Gemini for OCR. To use Llama 4 for extraction, specify a custom version string with `sagemaker` as the OCR provider.

## API Endpoints

- **API Gateway:** https://5p99qnahlb.execute-api.ap-south-1.amazonaws.com/api/llama4
- **SageMaker Endpoint:** emm-llama4-dev (direct invocation)

## Cost & Performance

- **Latency:** ~45s (cold start), ~4s (warm)
- **Cost:** ~$36/month (1k req/day)
- **Savings:** 96.5% vs provisioned instance

See `icd_benchmark_results.md` for detailed benchmarking data.

## Troubleshooting

### Endpoint Not Found

If you get "Endpoint not found", the auto-stop monitor may have deleted it. Restart via:

```bash
cd d:\Projects\MMT\EMM\infrastructure\terraform
terraform apply -auto-approve
```

### Cold Start Delays

First request after inactivity takes ~45s. Subsequent requests are faster (~4s).
