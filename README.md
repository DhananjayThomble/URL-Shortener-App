# URL Shortener Microservice Using Node and Express

Project Link: https://app.dhananjaythomble.me

For API Documentation and Testing: https://app.dhananjaythomble.me/docs-api

This repository contains an example implementation of a simple URL shortening service using Express.js, MongoDB and the mongoose driver, and the nanoid library.

## Features
- Generates a short URL for a given long URL.
- Redirects the user to the original URL when the short URL is visited.
- Validate the given url is valid or not before shortening it.
- Store short and original url in MongoDB.
- Website and Chrome extension to provide better user experience.

## Requirements
- Node.js
- npm or yarn
- MongoDB

## Installation
1) Clone the repository:
```
    git clone https://github.com/[username]/url-shortening-service.git
```
2) Install the dependencies:
```
npm install
```
3) Create a .env file in the root of the project and set environment variables for your MongoDB server and PORT Number for the application to run on.

4) Start the server:
```
npm start
```

## Usage

- To generate a short URL, send a POST request to the __/api/shorturl__ route with a JSON payload containing the url property.
- To redirect to the original URL, send a GET request to the __/api/shorturl/:short__ route, where :short is the generated short URL.
- The website and Chrome extension are designed to work with this service. The Chrome extension allows users to shorten URLs by simply clicking on the extension button, and the website allows users to input a URL and generate a short URL.

## Note
- You can use postman or Insomnia to test the application.
- Make sure that the MongoDB server is running before starting the application.

- The application is set to run on port 3000 by default, but you can configure this by setting the PORT environment variable.

- The cors middleware is used to allow cross-origin resource sharing (CORS) so that the server can accept requests from different origins (to be used in the case of Chrome extension).


