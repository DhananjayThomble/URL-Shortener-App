# URL Shortener Microservice Using Node and Express

Project Link: https://urlshortener-using-node-and-express.dhananjayt97.repl.co/

This is a NodeJS application that creates a URL shortener microservice. The application uses the Express framework to create a server and handle HTTP requests. The app uses the nanoid module to generate a random URL identifier for each URL that is submitted to the service. 

The app then stores the original URL and its corresponding short URL in an array and responds to the client with the original and short URL. The app also has a route to redirect short URLs to their corresponding original URLs. When a client makes a request to the short URL, the app checks the array for the short URL and redirects the client to the original URL if it exists.


## Getting Started

1. Install the required dependencies by running `npm install`
2. Start the server by running `npm start`

## Usage

To shorten a URL, send a POST request to the `/api/shorturl` endpoint with the URL to be shortened in the request body. The server will respond with a JSON object containing the original URL and the shortened URL.

To access a shortened URL, send a GET request to the `/api/shorturl/:short` endpoint, where `:short` is the shortened URL. The server will redirect the request to the original URL.

## Contributing

1. Fork the repository
2. Create a new branch for your changes
3. Commit your changes and push to the branch
4. Create a pull request

