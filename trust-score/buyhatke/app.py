from flask import Flask, render_template, request, jsonify
from flask_cors import CORS
import uuid

app = Flask(__name__)
CORS(app)

# In-memory sessions
# Key: session_id, Value: { status, product_title, results: [{store, price, url, image}] }
scrape_sessions = {}

@app.route('/')
def home():
    return render_template('index.html')

@app.route('/api/start_scrape', methods=['POST'])
def start_scrape():
    """Create a new scrape session."""
    data = request.json
    product_url = data.get('url', '')
    session_id = str(uuid.uuid4())[:8]

    scrape_sessions[session_id] = {
        'status': 'pending',
        'product_url': product_url,
        'product_title': '',
        'results': [],
        'done': False
    }

    print(f"[Session {session_id}] Started for: {product_url}")
    return jsonify({'status': 'success', 'session_id': session_id})

@app.route('/api/submit_all', methods=['POST'])
def submit_all():
    """Extension submits the complete scrape result all at once."""
    data = request.json
    session_id = data.get('session_id', '')

    if session_id not in scrape_sessions:
        return jsonify({'status': 'error', 'message': 'Invalid session ID'}), 400

    session = scrape_sessions[session_id]
    session['product_title'] = data.get('product_title', '')
    session['results'] = data.get('results', [])
    session['status'] = 'done'

    print(f"[Session {session_id}] Done. Title: {session['product_title']} | Results: {len(session['results'])}")
    for r in session['results']:
        print(f"  - {r.get('store','?')}: Rs.{r.get('price','?')}")

    return jsonify({'status': 'success'})

@app.route('/api/poll/<session_id>', methods=['GET'])
def poll_results(session_id):
    """Frontend polls this to check if scraping is complete."""
    if session_id not in scrape_sessions:
        return jsonify({'status': 'error', 'message': 'Invalid session ID'}), 400

    session = scrape_sessions[session_id]
    return jsonify({
        'status': session['status'],
        'product_title': session['product_title'],
        'results': session['results'] if session['status'] == 'done' else []
    })

if __name__ == '__main__':
    app.run(debug=True, port=5000)
