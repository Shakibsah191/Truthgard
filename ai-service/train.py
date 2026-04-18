import pandas as pd
from datasets import Dataset
from transformers import AutoTokenizer, AutoModelForSequenceClassification, Trainer, TrainingArguments
import torch

print("🚀 Step 1: Loading Datasets...")
# Load the two separate JSON files
fake_df = pd.read_json("Fake-1K.json") 
real_df = pd.read_json("Authentic-1K.json")

# Safety check: Force the labels just in case they were missed
fake_df['label'] = 0
real_df['label'] = 1

# Combine them into one big dataset
combined_df = pd.concat([fake_df, real_df], ignore_index=True)

# Shuffle the data perfectly so the AI gets a mixed test
combined_df = combined_df.sample(frac=1).reset_index(drop=True)

print(f"✅ Loaded {len(combined_df)} total articles.")
print(combined_df['label'].value_counts())

print("\n🚀 Step 2: Converting to Hugging Face format...")
dataset = Dataset.from_pandas(combined_df)
# Split: 80% for training, 20% for testing the AI's accuracy
dataset = dataset.train_test_split(test_size=0.2)

print("\n🚀 Step 3: Downloading Base BanglaBERT...")
model_name = "sagorsarker/bangla-bert-base"
tokenizer = AutoTokenizer.from_pretrained(model_name)
model = AutoModelForSequenceClassification.from_pretrained(model_name, num_labels=2)

print("\n🚀 Step 4: Tokenizing (Translating words to AI numbers)...")
def tokenize_function(examples):
    return tokenizer(examples["text"], padding="max_length", truncation=True, max_length=128)

tokenized_datasets = dataset.map(tokenize_function, batched=True