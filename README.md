# URL Shortener Microservice Using Node and Express

Project Link: https://urlshortener-using-node-and-express.dhananjayt97.repl.co/

This is a NodeJS application that creates a URL shortener microservice. The application uses the Express framework to create a server and handle HTTP requests. The app uses the nanoid module to generate a random URL identifier for each URL that is submitted to the service. 

The app then stores the original URL and its corresponding short URL in an array and responds to the client with the original and short URL. The app also has a route to redirect short URLs to their corresponding original URLs. When a client makes a request to the short URL, the app checks the array for the short URL and redirects the client to the original URL if it exists.
