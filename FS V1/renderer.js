const { ipcRenderer } = require("electron");

document.addEventListener("DOMContentLoaded", () => {
    const searchBox = document.getElementById("searchBox");
    const resultsContainer = document.getElementById("results");
    const movieContainer = document.getElementById("movieContainer");
    const backButton = document.getElementById("backButton");

    window.search = async function () {
        const query = searchBox.value.trim();
        if (!query) return alert("Please enter a search term!");

        try {
            const response = await fetch(`http://localhost:3001/search?q=${query}`);
            const data = await response.json();

            resultsContainer.innerHTML = ""; // Clear previous results

            if (data.length === 0) {
                resultsContainer.innerHTML = "<p>No results found.</p>";
                return;
            }

            data.forEach(item => {
                const card = document.createElement("div");
                card.classList.add("card");

                card.innerHTML = `
                    <img src="${item.thumbnail}" alt="${item.title}">
                    <h3>${item.title}</h3>
                    <p>Episodes: ${item.episodesCount}</p>
                    <p>Website: ${item.website}</p>
                `;

                card.addEventListener("click", () => {
                    console.log("Movie selected, showing back button."); 

                    // Hide search & results
                    searchBox.style.display = "none";
                    resultsContainer.style.display = "none";

                    // Show back button & movie
                    backButton.style.display = "block";  
                    movieContainer.style.display = "block";

                    // Format movie URL
                    const formattedTitle = item.title.replace(/\s+/g, '-').replace(/[()]/g, '');
                    const movieUrl = `${item.url}`;

                    // Load movie in iframe (full screen)
                    movieContainer.innerHTML = `
                        <button id="backButton" onclick="goBack()">⬅ Back</button>
                        <iframe src="${movieUrl}" width="100%" height="100%" allowfullscreen></iframe>
                    `;
                });

                resultsContainer.appendChild(card);
            });

        } catch (error) {
            resultsContainer.innerHTML = "<p>Failed to fetch results.</p>";

            console.error("Error fetching search results:", error);
            resultsContainer.innerHTML = "<p>Failed to fetch results.</p>";
        }
    };

    // Fix the Back Button Click Event
    window.goBack = function () {
        console.log("Back button clicked, showing search."); 

        // Show search & results again
        searchBox.style.display = "block";
        resultsContainer.style.display = "block";

        // Hide movie container & back button
        movieContainer.innerHTML = ""; // Clear movie content
        movieContainer.style.display = "none";
        backButton.style.display = "none";
    };
});
