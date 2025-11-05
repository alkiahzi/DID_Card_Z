import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import QRCode from "qrcode.react";

interface DIDCard {
  id: string;
  name: string;
  encryptedAge: string;
  publicValue1: number;
  publicValue2: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [cards, setCards] = useState<DIDCard[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingCard, setCreatingCard] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newCardData, setNewCardData] = useState({ name: "", age: "", description: "" });
  const [selectedCard, setSelectedCard] = useState<DIDCard | null>(null);
  const [decryptedAge, setDecryptedAge] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [showFAQ, setShowFAQ] = useState(false);
  const [stats, setStats] = useState({ total: 0, verified: 0, avgAge: 0 });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ visible: true, status: "error", message: "FHEVM initialization failed" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const cardsList: DIDCard[] = [];
      
      for (const id of businessIds) {
        try {
          const data = await contract.getBusinessData(id);
          cardsList.push({
            id,
            name: data.name,
            encryptedAge: id,
            publicValue1: Number(data.publicValue1) || 0,
            publicValue2: Number(data.publicValue2) || 0,
            description: data.description,
            creator: data.creator,
            timestamp: Number(data.timestamp),
            isVerified: data.isVerified,
            decryptedValue: Number(data.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading card data:', e);
        }
      }
      
      setCards(cardsList);
      calculateStats(cardsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const calculateStats = (cards: DIDCard[]) => {
    const total = cards.length;
    const verified = cards.filter(c => c.isVerified).length;
    const ages = cards.filter(c => c.isVerified).map(c => c.decryptedValue || 0);
    const avgAge = ages.length > 0 ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : 0;
    
    setStats({ total, verified, avgAge });
  };

  const createCard = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingCard(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating DID with FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract");
      
      const ageValue = parseInt(newCardData.age) || 0;
      const businessId = `did-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, ageValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newCardData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        0,
        0,
        newCardData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Processing..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "DID created!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewCardData({ name: "", age: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected") 
        ? "Transaction rejected" 
        : "Creation failed";
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingCard(false); 
    }
  };

  const decryptAge = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) return null;
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Age verified!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Already verified" });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Verification failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvail = await contract.isAvailable();
      if (isAvail) {
        setTransactionStatus({ visible: true, status: "success", message: "System available!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const renderAgeChart = () => {
    const ageGroups = [0, 0, 0, 0];
    cards.filter(c => c.isVerified).forEach(card => {
      const age = card.decryptedValue || 0;
      if (age < 18) ageGroups[0]++;
      else if (age < 30) ageGroups[1]++;
      else if (age < 50) ageGroups[2]++;
      else ageGroups[3]++;
    });
    
    const max = Math.max(...ageGroups) || 1;
    
    return (
      <div className="age-chart">
        <div className="chart-bar">
          <div className="bar-label">Under 18</div>
          <div className="bar-container">
            <div className="bar-fill" style={{ width: `${(ageGroups[0]/max)*100}%` }}>
              <span>{ageGroups[0]}</span>
            </div>
          </div>
        </div>
        <div className="chart-bar">
          <div className="bar-label">18-29</div>
          <div className="bar-container">
            <div className="bar-fill" style={{ width: `${(ageGroups[1]/max)*100}%` }}>
              <span>{ageGroups[1]}</span>
            </div>
          </div>
        </div>
        <div className="chart-bar">
          <div className="bar-label">30-49</div>
          <div className="bar-container">
            <div className="bar-fill" style={{ width: `${(ageGroups[2]/max)*100}%` }}>
              <span>{ageGroups[2]}</span>
            </div>
          </div>
        </div>
        <div className="chart-bar">
          <div className="bar-label">50+</div>
          <div className="bar-container">
            <div className="bar-fill" style={{ width: `${(ageGroups[3]/max)*100}%` }}>
              <span>{ageGroups[3]}</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderFAQ = () => (
    <div className="faq-section">
      <h3>Frequently Asked Questions</h3>
      <div className="faq-item">
        <div className="faq-question">What is FHE?</div>
        <div className="faq-answer">Fully Homomorphic Encryption allows computations on encrypted data without decryption.</div>
      </div>
      <div className="faq-item">
        <div className="faq-question">How is my age protected?</div>
        <div className="faq-answer">Your age is encrypted on-chain and only verifiable through zero-knowledge proofs.</div>
      </div>
      <div className="faq-item">
        <div className="faq-question">Can I delete my DID?</div>
        <div className="faq-answer">DIDs are permanent on the blockchain but you can revoke verification.</div>
      </div>
      <div className="faq-item">
        <div className="faq-question">How to verify offline?</div>
        <div className="faq-answer">Scan QR code with our verification app to confirm attributes without internet.</div>
      </div>
    </div>
  );

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>Private DID Card</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🆔</div>
            <h2>Connect Wallet to Start</h2>
            <p>Secure your identity with encrypted digital ID cards</p>
            <div className="fhe-flow">
              <div className="flow-step">
                <div className="step-icon">1</div>
                <div className="step-content">Connect Wallet</div>
              </div>
              <div className="flow-arrow">→</div>
              <div className="flow-step">
                <div className="step-icon">2</div>
                <div className="step-content">Create Encrypted ID</div>
              </div>
              <div className="flow-arrow">→</div>
              <div className="flow-step">
                <div className="step-icon">3</div>
                <div className="step-content">Verify Offline</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE System...</p>
        <p className="loading-note">Securing your identity data</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading DID Cards...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>Private DID Card</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + New ID Card
          </button>
          <button 
            onClick={checkAvailability} 
            className="check-btn"
          >
            Check System
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content-container">
        <div className="dashboard-section">
          <div className="stats-panel">
            <div className="stat-item">
              <div className="stat-value">{stats.total}</div>
              <div className="stat-label">Total IDs</div>
            </div>
            <div className="stat-item">
              <div className="stat-value">{stats.verified}</div>
              <div className="stat-label">Verified</div>
            </div>
            <div className="stat-item">
              <div className="stat-value">{stats.avgAge}</div>
              <div className="stat-label">Avg Age</div>
            </div>
          </div>
          
          <div className="chart-section">
            <h3>Age Distribution</h3>
            {renderAgeChart()}
          </div>
        </div>
        
        <div className="cards-section">
          <div className="section-header">
            <h2>My Digital ID Cards</h2>
            <div className="header-actions">
              <button 
                onClick={loadData} 
                className="refresh-btn" 
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
              <button 
                onClick={() => setShowFAQ(!showFAQ)}
                className="faq-btn"
              >
                {showFAQ ? "Hide FAQ" : "Show FAQ"}
              </button>
            </div>
          </div>
          
          {showFAQ && renderFAQ()}
          
          <div className="cards-list">
            {cards.length === 0 ? (
              <div className="no-cards">
                <p>No ID cards found</p>
                <button 
                  className="create-btn" 
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Card
                </button>
              </div>
            ) : cards.map((card, index) => (
              <div 
                className={`card-item ${selectedCard?.id === card.id ? "selected" : ""} ${card.isVerified ? "verified" : ""}`} 
                key={index}
                onClick={() => setSelectedCard(card)}
              >
                <div className="card-title">{card.name}</div>
                <div className="card-meta">
                  <span>Created: {new Date(card.timestamp * 1000).toLocaleDateString()}</span>
                </div>
                <div className="card-status">
                  {card.isVerified ? (
                    <span className="verified-badge">✅ Verified Age: {card.decryptedValue}</span>
                  ) : (
                    <span className="unverified-badge">🔒 Encrypted Age</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateCard 
          onSubmit={createCard} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingCard} 
          cardData={newCardData} 
          setCardData={setNewCardData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedCard && (
        <CardDetailModal 
          card={selectedCard} 
          onClose={() => { 
            setSelectedCard(null); 
            setDecryptedAge(null); 
          }} 
          decryptedAge={decryptedAge}
          decryptAge={() => decryptAge(selectedCard.id)}
          isDecrypting={isDecrypting}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateCard: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  cardData: any;
  setCardData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, cardData, setCardData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'age') {
      const intValue = value.replace(/[^\d]/g, '');
      setCardData({ ...cardData, [name]: intValue });
    } else {
      setCardData({ ...cardData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-card-modal">
        <div className="modal-header">
          <h2>Create Digital ID Card</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE Encryption</strong>
            <p>Your age will be encrypted with Zama FHE technology</p>
          </div>
          
          <div className="form-group">
            <label>Full Name *</label>
            <input 
              type="text" 
              name="name" 
              value={cardData.name} 
              onChange={handleChange} 
              placeholder="Your full name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Age (Integer only) *</label>
            <input 
              type="number" 
              name="age" 
              value={cardData.age} 
              onChange={handleChange} 
              placeholder="Your age..." 
              min="1"
              max="120"
            />
            <div className="data-type-label">FHE Encrypted</div>
          </div>
          
          <div className="form-group">
            <label>Description</label>
            <textarea 
              name="description" 
              value={cardData.description} 
              onChange={handleChange} 
              placeholder="Additional information..." 
              rows={3}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !cardData.name || !cardData.age} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Create ID Card"}
          </button>
        </div>
      </div>
    </div>
  );
};

const CardDetailModal: React.FC<{
  card: DIDCard;
  onClose: () => void;
  decryptedAge: number | null;
  isDecrypting: boolean;
  decryptAge: () => Promise<number | null>;
}> = ({ card, onClose, decryptedAge, isDecrypting, decryptAge }) => {
  const handleDecrypt = async () => {
    if (decryptedAge !== null) return;
    const age = await decryptAge();
    if (age !== null) setDecryptedAge(age);
  };

  return (
    <div className="modal-overlay">
      <div className="card-detail-modal">
        <div className="modal-header">
          <h2>Digital ID Card</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="card-info">
            <div className="info-item">
              <span>Name:</span>
              <strong>{card.name}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{card.creator.substring(0, 6)}...{card.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Created:</span>
              <strong>{new Date(card.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item">
              <span>Description:</span>
              <strong>{card.description}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Age</h3>
            
            <div className="data-row">
              <div className="data-label">Age Value:</div>
              <div className="data-value">
                {card.isVerified ? 
                  `${card.decryptedValue} (Verified)` : 
                  decryptedAge !== null ? 
                  `${decryptedAge} (Decrypted)` : 
                  "🔒 FHE Encrypted"
                }
              </div>
              {!card.isVerified && (
                <button 
                  className={`decrypt-btn ${decryptedAge !== null ? 'decrypted' : ''}`}
                  onClick={handleDecrypt} 
                  disabled={isDecrypting}
                >
                  {isDecrypting ? "Decrypting..." : "Decrypt Age"}
                </button>
              )}
            </div>
          </div>
          
          <div className="qr-section">
            <h3>Verification QR Code</h3>
            <div className="qr-container">
              <QRCode 
                value={`did:zama:${card.id}`} 
                size={180}
                bgColor="#0d0d15"
                fgColor="#7d5fff"
                level="H"
              />
            </div>
            <p className="qr-note">Scan to verify attributes offline</p>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!card.isVerified && decryptedAge !== null && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn"
            >
              Verify On-chain
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;


