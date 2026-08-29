const response = await fetch("http://127.0.0.1:3000/health").catch(() => undefined);
process.exit(response?.ok ? 0 : 1);
