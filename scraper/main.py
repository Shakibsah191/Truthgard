from fastapi import FastAPI
from pydantic import BaseModel
from bs4 import BeautifulSoup
import requests
import whois
from datetime import datetime

app = FastAPI()

# This defines what Express will send us
class ScrapeRequest(BaseModel):
    inputType: str       # "url" or "text"
    inputContent: str    # the URL or the raw text

@app.post("/scrape")
def scrape(data: ScrapeRequest):
    result = {
        "article_text": "",
        "source_url": "",
        "domain_age": None,
        "is_https": False
    }

    if data.inputType == "url":
        url = data.inputContent
        result["source_url"] = url
        result["is_https"] = url.startswith("https")

        # --- Fetch the page ---
        try:
            response = requests.get(url, timeout=10, headers={
                "User-Agent": "Mozilla/5.0"
            })
            soup = BeautifulSoup(response.text, "html.parser")

            # Remove junk tags
            for tag in soup(["script", "style", "nav", "footer", "header"]):
                tag.decompose()

            # Get main text
            result["article_text"] = soup.get_text(separator=" ", strip=True)[:5000]

        except Exception as e:
            result["article_text"] = f"Scrape failed: {str(e)}"

        # --- Check domain age with whois ---
        try:
            domain = url.split("/")[2]  # extract domain from URL
            w = whois.whois(domain)
            created = w.creation_date
            if isinstance(created, list):
                created = created[0]
            if created:
                age_days = (datetime.now() - created).days
                result["domain_age"] = age_days
        except:
            result["domain_age"] = None

    else:
        # Plain text — just clean it up
        result["article_text"] = data.inputContent.strip()

    return result