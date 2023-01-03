const form = document.querySelector("form");
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const url = form.url.value;
  const data = { url };

  const response = await fetch("https://app.dhananjaythomble.me/get/short", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  const responseData = await response.json();
  // console.log(responseData);

  const shortUrl = document.querySelector("#shortUrl");
  shortUrl.value = responseData.short_url;
  // display style of shortUrl
  shortUrl.style.display = "block";

  const copyBtn = document.querySelector("#copyBtn");
  copyBtn.style.display = "block";
  copyBtn.addEventListener("click", () => {
    const shortUrl = document.querySelector("#shortUrl");
    shortUrl.select();
    document.execCommand("copy");
    copyBtn.innerHTML = "Copied to clipboard";
  });
});
