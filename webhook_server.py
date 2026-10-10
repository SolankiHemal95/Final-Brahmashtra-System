from flask import Flask, request, jsonify
from flask_cors import CORS
from datetime import datetime

app = Flask(__name__)
CORS(app)

# In-memory storage for the latest signals
# We store a list of the last 2 signals per indicator
latest_signals = {
    "Lorentzian Classification": [],
    "Volumatic Variable": []
}

@app.route('/webhook', methods=['POST'])
def webhook():
    data = request.json
    if not data:
        return jsonify({"error": "Invalid JSON"}), 400
    
    indicator = data.get('indicator', 'Unknown')
    if indicator not in latest_signals:
        latest_signals[indicator] = []
        
    data['received_at'] = datetime.now().isoformat()
    
    # Keep only the last 2 signals
    latest_signals[indicator].append(data)
    if len(latest_signals[indicator]) > 2:
        latest_signals[indicator].pop(0)
        
    print(f"Received new signal for {indicator}: {data.get('action')} at {data.get('price')}")
    
    return jsonify({"status": "success", "message": "Signal processed"}), 200

@app.route('/api/latest_signals', methods=['GET'])
def get_signals():
    return jsonify(latest_signals), 200

# Endpoint to simulate a TradingView alert for testing purposes
@app.route('/simulate', methods=['GET'])
def simulate():
    import random
    import time
    indicator = request.args.get('indicator', 'Lorentzian Classification')
    action = random.choice(['BUY', 'SELL'])
    price = 2500.0 + random.uniform(-20, 20)
    data = {
        "indicator": indicator,
        "action": action,
        "timeframe": "15m",
        "price": round(price, 2),
        "timestamp": datetime.now().isoformat(),
        "received_at": datetime.now().isoformat()
    }
    
    if indicator not in latest_signals:
        latest_signals[indicator] = []
        
    latest_signals[indicator].append(data)
    if len(latest_signals[indicator]) > 2:
        latest_signals[indicator].pop(0)
        
    return jsonify({"status": "simulated", "data": data})

if __name__ == '__main__':
    print("Starting Webhook Server on port 5000...")
    app.run(host='0.0.0.0', port=5000)
