const token =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJfaWQiOiI2NTFjZDJiNTI1YTUwOGIwODQ0NmQzYWIiLCJpYXQiOjE2OTYzODc3ODQsImV4cCI6MTY5Njk5MjU4NH0.j1ubpVSrqfm9DhTUYQ4xBhZJj1WYHY1E5WmAYX4HnBM";

document.addEventListener("DOMContentLoaded", async function () {
  const historyTable = document.getElementById("historyTable");

  try {
    // Fetch history data from your server
    const response = await fetch("https://dturl.live/api/history", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`, // Replace with your actual authorization token
      },
    });

    if (!response.ok) {
      throw new Error("Error fetching history data.");
    }

    const historyData = await response.json();
    console.log(historyData.urlArray);
    // Function to populate the table with history data
    function populateTable() {
      historyData.urlArray.forEach((entry) => {
        const row = document.createElement("tr");

        const shortUrlCell = document.createElement("td");
        shortUrlCell.textContent = `https://dturl.live/u/${entry.shortUrl}`;

        const originalUrlCell = document.createElement("td");
        originalUrlCell.textContent = entry.originalUrl;

        const visitCountCell = document.createElement("td");
        visitCountCell.textContent = entry.visitCount;

        row.appendChild(shortUrlCell);
        row.appendChild(originalUrlCell);
        row.appendChild(visitCountCell);

        historyTable.appendChild(row);
      });
    }

    // Call the populateTable function when the page loads
    populateTable();
  } catch (error) {
    console.error(error);
    alert("An error occurred while fetching history data.");
  }
});
