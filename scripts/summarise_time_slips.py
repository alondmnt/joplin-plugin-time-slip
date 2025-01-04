import argparse
import pandas as pd
from wordcloud import WordCloud
from joppy.client_api import ClientApi
import matplotlib.pyplot as plt
import squarify
from io import StringIO
import os

# Function to parse duration into seconds
def parse_duration(duration):
    if pd.isna(duration):
        return 0
    h, m, s = map(int, duration.split(':'))
    return h * 3600 + m * 60 + s

# Function to aggregate durations
def aggregate_duration(df, group_by):
    df['Duration_sec'] = df['Duration'].apply(parse_duration)
    df = df.groupby(group_by)['Duration_sec'].sum()
    return df[df > 0]

# Function to plot a word cloud and save as PNG
def plot_word_cloud(data, title, file_name):
    wordcloud = WordCloud(width=800, height=400).generate_from_frequencies(data)
    plt.figure(figsize=(10, 5))
    plt.imshow(wordcloud, interpolation='bilinear')
    plt.title(title)
    plt.axis('off')
    plt.savefig(file_name)
    plt.close()

# Function to plot a treemap and save as PNG
def plot_treemap(data, title, file_name, show_time=False):
    if show_time:
        labels = [f"{key}\n{value//3600}h{(value%3600)//60}m" for key, value in data.items()]
    else:
        labels = [key for key in data.keys()]
    sizes = list(data.values())
    plt.figure(figsize=(10, 8))
    squarify.plot(sizes=sizes, label=labels, alpha=0.8)
    plt.title(title)
    plt.axis('off')
    plt.savefig(file_name)
    plt.close()

# Function to load and process data from the API
def load_data(api_token):
    client = ClientApi(api_token)
    notes = client.search(query='tag:time-slip', fields='title,body').items
    return [(note.title, pd.read_csv(StringIO(note.body))) for note in notes]

# Main function
def main(api_token, output_dir, wordcloud, treemap):
    notes = load_data(api_token)

    for title, df in notes:
        # Aggregate durations
        task_aggregation = aggregate_duration(df, 'Task')
        project_aggregation = aggregate_duration(df, 'Project')

        # Generate and save Word Clouds
        if wordcloud:
            plot_word_cloud(task_aggregation.to_dict(), "Task Duration Word Cloud", os.path.join(output_dir, f"{title}_task_wordcloud.png"))
            plot_word_cloud(project_aggregation.to_dict(), "Project Duration Word Cloud", os.path.join(output_dir, f"{title}_project_wordcloud.png"))

        # Generate and save Treemaps
        if treemap:
            plot_treemap(task_aggregation.to_dict(), "Task Duration Treemap", os.path.join(output_dir, f"{title}_task_treemap.png"))
            plot_treemap(project_aggregation.to_dict(), "Project Duration Treemap", os.path.join(output_dir, f"{title}_project_treemap.png"))

# CLI argument parser
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate Word Cloud or Treemap visualisations from time-slip notes.")
    parser.add_argument("api_token", type=str, help="Joplin API token to access notes.")
    parser.add_argument("output_dir", type=str, help="Directory to save the generated PNG files.")
    parser.add_argument("--wordcloud", action="store_true", help="Generate Word Cloud images.")
    parser.add_argument("--treemap", action="store_true", help="Generate Treemap images.")
    
    args = parser.parse_args()

    if not os.path.exists(args.output_dir):
        os.makedirs(args.output_dir)

    main(args.api_token, args.output_dir, args.wordcloud, args.treemap)
