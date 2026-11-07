"""A terminal echo fixture for testing the phone without contacting an agent."""
import sys

def state(value):
    print(f"\x1b]7501;state={value}:app=codex\x1b\\", end="", flush=True)

print("HERDR POCKET TEST TERMINAL", flush=True)
print("This is a local echo fixture. No model or shell command is invoked.", flush=True)
state("idle")
for line in sys.stdin:
    state("working")
    print("POCKET_RECEIVED: " + line.rstrip(), flush=True)
    state("done")
