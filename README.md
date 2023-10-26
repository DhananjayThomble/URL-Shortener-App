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
- Chrome extension for URL shortening.

## Future Plans

We have exciting plans to enhance SnapURL in the future, making it even more robust and user-friendly. Our upcoming features include:

### User Profile Enhancements
- [ ] **User Profile Visibility**: Choose whether your profile is public or private.
- [ ] **User Profile Page**: Display user's name, profile picture, bio, and a summary of their URL activity.
- [ ] **User Analytics**: View statistics for the links shared, including total clicks and views.

### Advanced URL Management
- [x] **Categories for Short URLs**: Organize shortened links into categories for better management.
- [ ] **Bundled URLs**: Group multiple URLs into a single bundled link for easy sharing.
- [ ] **Password Protection**: Add password protection to specific URLs for added security.

### Analytics and Reporting
- [ ] **User Analytics Dashboard**: Provide users with an analytics dashboard to monitor their URL performance.
- [ ] **User Notifications**: Notify users when their URLs reach a certain number of clicks or other milestones.
- [ ] **Link Expiry**: Allow users to set an expiration date for their URLs.

### Integration and Sharing
- [x] **Browser Extensions**: Develop browser extensions for quick URL shortening and management.
- [ ] **Custom Domains**: Enable users to use custom domains for branded short URLs.

### Enhanced User Experience
- [ ] **User Feedback System**: Implement a feedback system to collect user opinions and suggestions.
- [ ] **Mobile Apps**
- [ ] **Multi-Language Support**: Localize SnapURL for users worldwide.
- [ ] **Dark Mode**: Introduce a dark mode option for the user interface.

### Additional Feature Ideas
- [x] **QR Code Generation**: Generate QR codes for shortened URLs for easy mobile sharing.
- [ ] **Social Media Sharing**: Add one-click sharing to popular social media platforms.
- [ ] **Link Preview Thumbnails**: Display link previews with thumbnails for better user experience.
- [ ] **Bookmark Management**: Help users organize and manage their bookmarked URLs.
- [ ] **URL Commenting**: Allow users to add comments to URLs for context.

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

- The Node.js backend is hosted on the AWS EC2 running Ubuntu and managed using PM2. [API Documentation](https://snapurl.in/doc)

- The React frontend is hosted on Netlify. The URL for the frontend is: https://app.snapurl.in

- The API documentation is generated using Swagger. The URL for the API documentation
  is: https://snapurl.in/doc

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
FRONTEND_URL=<your-frontend-webapp-url>
```

Example .env file:
```bash
DB_URL=mongodb+srv://<username>:<password>@<cluster-url>/<database-name>?retryWrites=true&w=majority
JWT_SECRET=secret
SESSION_SECRET=secret
PORT=4001
BASE_URL=http://localhost:4001
SHORT_URL_PREFIX=http://localhost:4001/u/
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_HOST_USER=john@gmail.com
EMAIL_HOST_PASSWORD=john123
FRONTEND_URL=https://app.snapurl.in
```

You can get your MongoDB database URL from [here](https://www.mongodb.com/cloud/atlas).

You can get your Email Host, Email Port, Email Host User and Email Host Password from your email service provider. 
You can even use your **Gmail** account for this. If you have enabled 2-step verification for your gmail account, you will need to generate an app password. you can find more information about this [here](https://support.google.com/accounts/answer/185833?hl=en).

Contact me if you need help with this.

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
VITE_API_ENDPOINT=http://localhost:4001
```

iv. Start the frontend server:
```bash
npm start
```

5. Open http://localhost:4001/doc to view the API documentation.
6. To view the frontend, check the terminal for the URL.

## Contributing

SnapURL is a welcoming community for all contributors. Feel free to open an issue or submit a pull request! Your feedback and contributions are always welcome as we continue to grow and improve

## Additional Resources
- **Wiki**: Explore our [Wiki](https://github.com/DhananjayThomble/URL-Shortener-App/wiki) to learn more about the project.
- **Milestones**: Check out our [Milestones](https://github.com/DhananjayThomble/URL-Shortener-App/milestones) to see what we are working on.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

Enjoy your journey with SnapURL! 🚀

