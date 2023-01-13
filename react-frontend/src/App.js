import {useState} from "react";
import "./App.css";

function App() {

    const [url, setUrl] = useState('');
    const [error, setError] = useState('');
    const [shortUrl, setShortUrl] = useState('');
    const handleSubmit = () => {

    }

    return (
        <div>
            <Header/>

            <main>
                <section>
                    <form id="shorten-form">
                        <label htmlFor="url">Enter the URL to Shorten:</label>
                        <input type="url" id="url" name="url" required/>
                        <button type="submit">Shorten</button>
                    </form>
                </section>

                <section id="shortened-urls">
                    <h2>Recent Shortened URLs</h2>
                    <table>
                        <thead>
                        <tr>
                            <th>Short URL</th>
                            <th>Original URL</th>
                            <th>Actions</th>
                        </tr>
                        </thead>
                        <tbody id="url-table-body"></tbody>
                    </table>
                </section>
            </main>
            <Footer/>
        </div>
    );

}

function Header() {
    return (
        <header>
            <h1>URL Shortener</h1>
        </header>
    );
}

const Footer = () => (
    <footer>
        <p>By <a href="https://dhananjaythomble.me/">Dhananjay Thomble</a></p>
    </footer>
)

export default App;
