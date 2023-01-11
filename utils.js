const isValidUrl = (urlString) => {
  try {
    // Parse the URL and check if it is a valid URL
    let url = new URL(urlString);

    // Check if the URL has a protocol and hostname
    if (!url.protocol || !url.hostname) return false;

    // Check if the URL has a valid port
    if (url.port && isNaN(parseInt(url.port))) return false;

    // Check if the URL has any search parameters
    let searchParams = new URLSearchParams(url.search);
    if (searchParams.toString()) return true;

    // Return true if the URL is valid and has no search parameters
    return true;
  } catch (error) {
    // If the URL is invalid, return false
    return false;
  }
};

export default isValidUrl;
