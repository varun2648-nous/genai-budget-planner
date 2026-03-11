import chromadb
from chromadb.config import Settings

# Tell Chroma to use the folder you created
client = chromadb.Client(Settings(
    persist_directory="./chroma"
))

# Create a collection
collection = client.get_or_create_collection(name="my_collection")

# Add one test document (this activates the database)
collection.add(
    documents=["Chroma is working"],
    ids=["1"]
)

print("Chroma is now using your project folder")
print("Database location: ./chroma")
print("Documents stored:", collection.count())
