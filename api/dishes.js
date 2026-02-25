const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

let db, dishesCollection;

async function connect() {
  if (!db) {
    await client.connect();
    db = client.db('dinnerSpinner');
    dishesCollection = db.collection('dishes');
    
    // Initialize with default dishes if empty
    const count = await dishesCollection.countDocuments();
    if (count === 0) {
      const DEFAULT_DISHES = [
        'Pizza', 'Tacos', 'Pasta', 'Sushi', 'Burger', 
        'Curry', 'Stir Fry', 'Salad', 'Sandwich', 'Soup',
        'Ramen', 'Paella', 'BBQ', 'Falafel', 'Kebab'
      ];
      await dishesCollection.insertOne({ 
        _id: 'userDishes', 
        dishes: DEFAULT_DISHES,
        theme: 'light' 
      });
    }
  }
  return dishesCollection;
}

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const collection = await connect();

    if (req.method === 'GET') {
      const userData = await collection.findOne({ _id: 'userDishes' });
      return res.json(userData || { dishes: [], theme: 'light' });
    }

    if (req.method === 'POST') {
      const { dishes, theme } = req.body;
      const update = {};
      if (dishes !== undefined) update.dishes = dishes;
      if (theme !== undefined) update.theme = theme;
      
      await collection.updateOne(
        { _id: 'userDishes' },
        { $set: update },
        { upsert: true }
      );
      return res.json({ success: true });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('MongoDB error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
