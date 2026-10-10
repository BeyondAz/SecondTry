# Pyspace Python Playground

Pyspace is a browser-based Python playground. Edit `main.py` with Python
syntax highlighting, describe what you want the code to do, and run it in the
output console. Python runs in the browser with Pyodide; use **Download** to
save your code as `main.py`.

The **Fix my code** action uses the `/api/fix` Gemini endpoint. Set
`GEMINI_API_KEY` in the server environment (or your hosting provider's
environment-variable settings) before starting or deploying the app; the key
is never sent to the browser. If intended behavior is unclear, the app asks a
follow-up question. Suggested fixes include a summary, explained changes, and
an underlying Python concept. Compare the original and corrected code, then
use **Copy corrected code** to copy the suggestion. Failed requests show a
readable error and a **Retry** action. **Load example** fills the editor and
optional context fields with a sample bug to fix.

## Run locally

Install dependencies and start the development server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
