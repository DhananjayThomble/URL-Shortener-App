import chaiHttp from 'chai-http';
import chai from 'chai';
import { expect } from 'chai';
import dotenv from 'dotenv';
import { app } from './mainTest.js';

dotenv.config();

chai.use(chaiHttp);

const MOCK_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJfaWQiOiI2NTFlZTBlOGQ4NTQ3NDkyNGVlYTU2ZmIiLCJpYXQiOjE2OTcxMjYzMDIsImV4cCI6MTY5NzczMTEwMn0.FbNfFFiG0biv_4kD16h8OVXqUcvsEksh5iRFusACKhI';

const EXPIRED_TOKEN =
  'abchbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJfaWQiOiI2NTFlZTBlOGQ4NTQ3NDkyNGVlYTU2ZmIiLCJpYXQiOjE2OTcxMjYzMDIsImV4cCI6MTY5NzczMTEwMn0.FbNfFFiG0biv_4kD16h8OVXqUcvsEksh5iRFusACKhI';

describe('URL Controller Tests', () => {
  it('should generate a short URL with a valid URL and token', (done) => {
    chai
      .request(app)
      .post(`/api/url`)
      .set('Authorization', 'Bearer ' + MOCK_TOKEN)
      .send({ url: 'https://dturl.live/' })
      .end((err, res) => {
        expect(err).to.be.null; // Check for no errors
        expect(res).to.have.status(200); // Check for the expected HTTP status
        expect(res.body).to.have.property('shortUrl'); // Check for the expected response properties
        done(); //  call done() to indicate that the test is complete
      });
  });

  it('should return an error for an invalid URL', (done) => {
    chai
      .request(app)
      .post(`/api/url`)
      .set('Authorization', 'Bearer ' + MOCK_TOKEN)
      .send({ url: 'invalid-url' })
      .end((err, res) => {
        expect(err).to.be.null;
        expect(res).to.have.status(400);
        // we can check for an error response, e.g., `expect(res.body).to.have.property("error")`
        done();
      });
  });

  it('should return an error if no token is provided', (done) => {
    chai
      .request(app)
      .post(`/api/url`)
      .send({ url: 'https://dturl.live/' })
      .end((err, res) => {
        expect(err).to.be.null;
        expect(res).to.have.status(401);
        done();
      });
  });

  it('should return an error if an expired token is used', (done) => {
    chai
      .request(app)
      .post(`/api/url`)
      .set('Authorization', 'Bearer ' + EXPIRED_TOKEN)
      .send({ url: 'https://dturl.live/' })
      .end((err, res) => {
        expect(err).to.be.null;
        expect(res).to.have.status(401);
        done();
      });
  });
});

// dummy test
describe('Dummy Test', () => {
  it('should return true', (done) => {
    expect(true).to.be.true;
    done();
  });
});
