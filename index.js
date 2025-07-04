const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const admin = require('firebase-admin');
// Load env vars
dotenv.config();
const stripe = require('stripe')(process.env.PAYMENT_GATEWAY_KEY);

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Firebase
const serviceAccount = require('./firebase-admin-key.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
// MongoDB

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.zsjpk5h.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // DB and Collection
    const db = client.db('Profast');
    const ParcelCollection = db.collection('parcels');
    const paymentsCollection = db.collection('payments');
    const usersCollection = db.collection('users');
    const warehousesCollection = db.collection('warehouse');
    const ridersCollection = db.collection('riders');
    // Custom MIddleware
    const verifyFirebaseToken = async (req, res, next) => {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).send({ message: 'Unauthorized access' });
      }
      const token = authHeader.split(' ')[1];
      if (!token) {
        return res.status(401).send({ message: 'Unauthorized access' });
      }
      // Verify Token
      try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.decoded = decoded;
        next();
      } catch (error) {
        return res.status(403).send({ message: 'forbidden access' });
      }
    };
    // Rider Related Apis:
    app.post('/riders', async (req, res) => {
      const email = req.body.email;
      const user = req.body;
      // const userExists = await ridersCollection.findOne({ email: email });
      // if (userExists) {
      //   // update last log in info
      //   return res
      //     .status(200)
      //     .send({ message: 'User Already Exists', inserted: false });
      // }
      const result = await ridersCollection.insertOne(user);
      res.send(result);
    });
    app.get('/riders/pending', async (req, res) => {
      try {
        const result = await ridersCollection
          .find({ status: 'pending' })
          .toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });
    app.get('/riders/active', async (req, res) => {
      try {
        const result = await ridersCollection
          .find({ status: 'active' })
          .toArray();

        res.send(result);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });
    app.patch('/riders/:id', async (req, res) => {
      const id = req.params.id;
      const { status, email } = req.body;
      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: { status: status },
      };
      try {
        const result = await ridersCollection.updateOne(query, updateDoc);

        //  update user role for accepting rider
        if (status === 'active') {
          const userQuery = { email };
          const userUpdateDoc = {
            $set: { role: 'rider' },
          };
          const roleResult = await usersCollection.updateOne(
            userQuery,
            userUpdateDoc
          );
          console.log(roleResult.matchedCount);
        }
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });

    //User RElated Apis:
    app.post('/users', async (req, res) => {
      const email = req.body.email;
      const user = req.body;
      const userExists = await usersCollection.findOne({ email: email });
      if (userExists) {
        // update last log in info
        return res
          .status(200)
          .send({ message: 'User Already Exists', inserted: false });
      }
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.get('/users/search', async (req, res) => {
      const emailQuery = req.query.email;
      if (!emailQuery) {
        return res.status(400).send({ message: 'Missing email query' });
      }

      const regex = new RegExp(emailQuery, 'i'); // case-insensitive partial match

      try {
        const users = await usersCollection
          .find({ email: { $regex: regex } })
          // .project({ email: 1, createdAt: 1, role: 1 })
          .limit(10)
          .toArray();
        res.send(users);
      } catch (error) {
        console.error('Error searching users', error);
        res.status(500).send({ message: 'Error searching users' });
      }
    });

    app.patch('/users/:id/role', async (req, res) => {
      const { id } = req.params;
      const { role } = req.body;

      if (!['admin', 'user'].includes(role)) {
        return res.status(400).send({ message: 'Invalid role' });
      }

      try {
        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { role } }
        );
        res.send({ message: `User role updated to ${role}`, result });
      } catch (error) {
        console.error('Error updating user role', error);
        res.status(500).send({ message: 'Failed to update user role' });
      }
    });

    // Create a new parcel
    app.post('/parcels', async (req, res) => {
      const newparcel = req.body;
      const result = await ParcelCollection.insertOne(newparcel);
      res.send(result);
    });

    // Get all parcels

    app.get('/parcels', verifyFirebaseToken, async (req, res) => {
      try {
        const userEmail = req.query.email;
        if (req.decoded.email !== userEmail) {
          return res.status(403).send({ message: 'forbidden access' });
        }
        const query = userEmail ? { created_by: userEmail } : {};
        const options = {
          sort: { createdAT: -1 },
        };
        const result = await ParcelCollection.find(query, options).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });
    // Get a single parcel
    app.get('/parcels/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await ParcelCollection.findOne(query);
      res.send(result);
    });
    // Delete A parcel
    app.delete('/parcels/:id', async (req, res) => {
      const id = req.params.id;
      console.log(id);
      const query = { _id: new ObjectId(id) };
      const result = await ParcelCollection.deleteOne(query);
      res.send(result);
    });

    // Stripe
    app.post('/create-payment-intent', async (req, res) => {
      const amountInCents = req.body.amountInCents;
      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amountInCents, // amount in cents
          currency: 'bdt',
          payment_method_types: ['card'],
        });

        res.json({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // POST: Record payment and update parcel status
    app.post('/payments', async (req, res) => {
      const { id, email, amount, paymentMethod, transactionId } = req.body;

      try {
        const updateResult = await ParcelCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: { payment_status: 'paid' },
          }
        );

        if (updateResult.matchedCount === 0) {
          return res.status(404).send({ message: 'Parcel not found' });
        }

        const paymentDoc = {
          parcel_id: id,
          email,
          amount,
          paymentMethod,
          transactionId,
          paid_at_string: new Date().toISOString(),
          paid_at: new Date(),
        };

        const paymentResult = await paymentsCollection.insertOne(paymentDoc);

        // Send response back to client!
        res.status(201).send({
          message: 'Payment recorded and parcel marked as paid',
          insertedId: paymentResult.insertedId,
        });
      } catch (error) {
        console.error('Payment processing failed:', error);
        res.status(500).send({ message: 'Failed to record payment' });
      }
    });

    // GET:Get Payments
    app.get('/payments', verifyFirebaseToken, async (req, res) => {
      try {
        const userEmail = req.query.email;

        if (req.decoded.email !== userEmail) {
          return res.status(403).send({ message: 'forbidden access' });
        }
        const query = userEmail ? { email: userEmail } : {};
        const options = {
          sort: { paid_at: -1 },
        };
        const result = await paymentsCollection.find(query, options).toArray();
        if (result.length > 0) {
          res.send(result);
        } else {
          res.send([]);
        }
      } catch (error) {}
    });
    // warehouse
    app.get('/warehouse', async (req, res) => {
      const result = await warehousesCollection.find().toArray();
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    // await client.db('admin').command({ ping: 1 });
    // console.log(
    //   'Pinged your deployment. You successfully connected to MongoDB!'
    // );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

// Sample route
app.get('/', (req, res) => {
  res.send('Parcel Server is Running ✅');
});

// Start server
app.listen(port, () => {
  console.log(`🚀 Server is running on http://localhost:${port}`);
});
