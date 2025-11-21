# STEP 1
read [architecture doc](/ai/ARCHITECTIRE.md)

Now lets ONLY do first step of implementation which is

## PLAN
1. Setup the pnpm / typescript monorepo that has 3 packages
   - client (nextjs)
   - server (hono)
   - shared (shared types)

Use a base tsconfig in the root and extend it in /client and /server as needed

Let /server and /client have their separate env files
   
2. setup the newst nextjs in /client and shadcn+tailwind (make sure to use the nreest taiwlind that shadcn SUPPORTS!), lets add shadcn button component as an example. add mock home page.tsx that just says "Welcone" and shows the shadcn "Click me" button.

3. setup hono server in /server and add just /healthcheck endpoint that checks whether the server is up

4. add the commands specified in architecture doc to the package.jsons (the combining commands in the root, and the particualr ones in /server and /client)

5. use the pnpm dev:without-sandbox commands to spin up be and fe and use http to test whether fe return what was specified and /healtcheck as well. If not debug
