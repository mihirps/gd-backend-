# Backend API

Simple Express backend for handling form submissions from the Next.js frontend.

## Scripts

- `npm start` &mdash; start the backend server on port 4000.

## Endpoints

- `POST /api/contact` &mdash; accepts JSON body with fields:
  - `name` (string, required)
  - `email` (string, required)
  - `message` (string, required)
  Returns a confirmation response with a timestamp.

- `POST /api/feedback` &mdash; accepts JSON body with fields:
  - `email` (string, optional)
  - `rating` (number 1&ndash;5, required)
  - `comments` (string, optional)
  Returns a confirmation response with a timestamp.

Both endpoints are intended to be called from the Next.js frontend over HTTPS.


