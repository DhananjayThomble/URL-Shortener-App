# SnapURL: The Beginner-Friendly URL Shortener
SnapURL is an open-source URL shortener web application and chrome-extension. It simplifies the process of converting long URLs into short and shareable links.

## Features

- User signup and login.
- Email verification for added security.
- Password reset via email.
- Robust password hashing with Bcrypt.
- Automated email notifications for account creation and password resets.
- URL shortening with randomly generated 10-character strings.
- Visit count tracking for shortened URLs.
- User-specific lists of generated URLs.
- Deletion of shortened URLs.
- Secure API authentication using JSON Web Tokens (JWT).
- Express Rate Limit for API rate limiting.
- Cross-Origin Resource Sharing (CORS) enabled.
- API documentation powered by Swagger.
- Export Generated URLs to Excel file.


## Tech Stack

### Backend

- Node.js
- Express.js
- MongoDB
- Bcrypt
- Cors
- EJS (for email templates)
- Express-rate-limit
- JSON Web Tokens (JWT)
- Mongoose
- Nanoid
- Passport
- Passport-jwt
- Swagger UI Express
- Yamljs

### Frontend

- React.js
- Axios
- Prettier
- React-bootstrap
- Material-ui
- React-dom
- React-icons
- React-router-dom
- React-toastify

## Deployment

- The Node.js backend is hosted on the AWS EC2 running Ubuntu and managed using PM2. [API Documentation](https://dturl.live/doc)

- The React frontend is hosted on Netlify. The URL for the frontend is: https://app.dturl.live

- The API documentation is generated using Swagger. The URL for the API documentation
  is: https://dturl.live/doc

## Prerequisites

- Node.js and npm installed on your local machine
- A MongoDB database

## Getting Started

1. Clone the repository:
    ```bash
    git clone https://github.com/DhananjayThomble/URL-Shortener-App.git
    ```
### for backend:

i. Goto the backend directory:
```bash
cd backend
```

ii. Install the dependencies:
```bash
npm install
```

iii. Create a .env file in the backend directory and add the following environment variables:
```bash
DB_URL=<your-mongodb-database-url>
JWT_SECRET=<your-jwt-secret>
SESSION_SECRET=<your-session-secret>
PORT=4001
BASE_URL=http://localhost:4001
SHORT_URL_PREFIX=http://localhost:4001/u/ 
EMAIL_HOST=<your-email-host>, e.g. smtp.gmail.com
EMAIL_PORT=<your-email-port>, e.g. 587
EMAIL_HOST_USER=<your-email-host-user>, e.g. john@gmail.com
EMAIL_HOST_PASSWORD=<your-email-host-password>, e.g. john123
```

You can get your MongoDB database URL from [here](https://www.mongodb.com/cloud/atlas).
You can get your Email Host, Email Port, Email Host User and Email Host Password from your email service provider. Contact me if you need help with this.

iv. Start the backend server:
```bash
npm run dev
```

### for frontend:

i. Goto the frontend directory:
```bash
cd frontend
```

ii. Install the dependencies:
```bash
npm install
```

iii. Create a .env file in the frontend directory and add the following environment variables:
```bash
REACT_APP_API_ENDPOINT=http://localhost:4001
```

iv. Start the frontend server:
```bash
npm start
```

5. Open http://localhost:4001/doc to view the API documentation.
6. Goto http://localhost:3000 to view the frontend.

## Contributing

SnapURL is a welcoming community for all contributors. Feel free to open an issue or submit a pull request!

## Additional Resources
- **Wiki**: Explore our [Wiki](https://github.com/DhananjayThomble/URL-Shortener-App/wiki) to learn more about the project.
- **Milestones**: Check out our [Milestones](https://github.com/DhananjayThomble/URL-Shortener-App/milestones) to see what we are working on.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

Enjoy your journey with SnapURL! 🚀

