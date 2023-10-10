document.addEventListener("DOMContentLoaded", function () {
  const form = document.querySelector("form");
  const urlInput = form.querySelector("#inputUrl");
  const shortUrl = form.querySelector("#shortUrl");
  const copyBtn = form.querySelector("#copyBtn");
  const token =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJfaWQiOiI2NTFjZDJiNTI1YTUwOGIwODQ0NmQzYWIiLCJpYXQiOjE2OTYzODc3ODQsImV4cCI6MTY5Njk5MjU4NH0.j1ubpVSrqfm9DhTUYQ4xBhZJj1WYHY1E5WmAYX4HnBM";
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const longUrl = urlInput.value.trim(); // Trim any leading/trailing spaces

    if (!longUrl) {
      // Check if the URL input is empty
      alert("Please enter a valid URL.");
      return;
    }

    const data = { url: longUrl };

    try {
      const response = await fetch("https://dturl.live/api/url", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error("Error shortening URL.");
      }

      const responseData = await response.json();

      shortUrl.value = responseData.shortUrl;
      shortUrl.style.display = "block";
      copyBtn.style.display = "block";
    } catch (error) {
      console.error(error);
      alert("An error occurred while shortening the URL.");
    }
  });

  // Copy to clipboard functionality (no changes needed)
  copyBtn.addEventListener("click", () => {
    shortUrl.select();
    document.execCommand("copy");
    copyBtn.innerHTML = "Copied to clipboard";
  });

  // Get current tab URL
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const url = tabs[0].url;
    urlInput.value = url;
  });

  // Add a click event listener to the historyBtn
  historyBtn.addEventListener("click", async () => {
    // try {
    //   const response = await fetch("https://dturl.live/api/history", {
    //     method: "GET",
    //     headers: {
    //       "Content-Type": 'application/json',
    //       Authorization: `Bearer ${token}`,
    //     },
    //   });

    //   if (!response.ok) {
    //     throw new Error("Error fetching history.");
    //   }

    //   const responseData = await response.json();
    //   console.log(responseData)
    //   // Open the history in a new tab
      chrome.tabs.create({ url: chrome.runtime.getURL('history.html')});
    // } catch (error) {
    //   console.error(error);
    //   alert("An error occurred while fetching the history.");
    // }
  });
});
