"""Keep UiAutomator connected so WebView accessibility updates remain observable."""

import json
import os
import sys

import uiautomator2


device = uiautomator2.connect(os.environ.get("ANDROID_SERIAL") or None)
for request in sys.stdin:
    try:
        json.loads(request)
        result = {"xml": device.dump_hierarchy(compressed=False)}
    except Exception as error:
        result = {"error": str(error)}
    print(json.dumps(result), flush=True)
