// Configuration Firebase du projet mywatchlist.
// Ces valeurs ne sont pas secrètes : la sécurité vient des règles Firestore
// (voir ../firestore.rules) et de la restriction de la clé à linerol.github.io.
export const firebaseConfig = {
  apiKey: "AIzaSyAey8QHNC8pymmsRSJMaEomAck0EERKQDA",
  authDomain: "mywatchlist-3fe82.firebaseapp.com",
  projectId: "mywatchlist-3fe82",
  storageBucket: "mywatchlist-3fe82.firebasestorage.app",
  messagingSenderId: "293128629784",
  appId: "1:293128629784:web:6d0ee4a64099f4426f1d6d"
};

// Adresse vers laquelle renvoient les emails de vérification et de mot de passe.
export const SITE_URL = location.origin + location.pathname.replace(/[^/]*$/, '');
