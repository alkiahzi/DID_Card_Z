pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract DIDCardAdapter is ZamaEthereumConfig {
    
    struct IdentityCard {
        string cardId;                    
        euint32 encryptedAge;              
        euint32 encryptedEligibility;      
        string description;                
        address owner;                    
        uint256 issuanceDate;              
        uint32 decryptedAge;               
        uint32 decryptedEligibility;       
        bool ageVerified;                  
        bool eligibilityVerified;          
    }
    
    mapping(string => IdentityCard) public identityCards;
    string[] public cardIds;
    
    event CardCreated(string indexed cardId, address indexed owner);
    event AgeVerified(string indexed cardId, uint32 age);
    event EligibilityVerified(string indexed cardId, uint32 eligibility);
    
    constructor() ZamaEthereumConfig() {
    }
    
    function createIdentityCard(
        string calldata cardId,
        externalEuint32 encryptedAge,
        bytes calldata ageProof,
        externalEuint32 encryptedEligibility,
        bytes calldata eligibilityProof,
        string calldata description
    ) external {
        require(bytes(identityCards[cardId].cardId).length == 0, "Card already exists");
        
        require(FHE.isInitialized(FHE.fromExternal(encryptedAge, ageProof)), "Invalid age encryption");
        require(FHE.isInitialized(FHE.fromExternal(encryptedEligibility, eligibilityProof)), "Invalid eligibility encryption");
        
        identityCards[cardId] = IdentityCard({
            cardId: cardId,
            encryptedAge: FHE.fromExternal(encryptedAge, ageProof),
            encryptedEligibility: FHE.fromExternal(encryptedEligibility, eligibilityProof),
            description: description,
            owner: msg.sender,
            issuanceDate: block.timestamp,
            decryptedAge: 0,
            decryptedEligibility: 0,
            ageVerified: false,
            eligibilityVerified: false
        });
        
        FHE.allowThis(identityCards[cardId].encryptedAge);
        FHE.allowThis(identityCards[cardId].encryptedEligibility);
        
        FHE.makePubliclyDecryptable(identityCards[cardId].encryptedAge);
        FHE.makePubliclyDecryptable(identityCards[cardId].encryptedEligibility);
        
        cardIds.push(cardId);
        
        emit CardCreated(cardId, msg.sender);
    }
    
    function verifyAge(
        string calldata cardId, 
        bytes memory abiEncodedAge,
        bytes memory decryptionProof
    ) external {
        require(bytes(identityCards[cardId].cardId).length > 0, "Card does not exist");
        require(!identityCards[cardId].ageVerified, "Age already verified");
        
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(identityCards[cardId].encryptedAge);
        
        FHE.checkSignatures(cts, abiEncodedAge, decryptionProof);
        
        uint32 decodedAge = abi.decode(abiEncodedAge, (uint32));
        
        identityCards[cardId].decryptedAge = decodedAge;
        identityCards[cardId].ageVerified = true;
        
        emit AgeVerified(cardId, decodedAge);
    }
    
    function verifyEligibility(
        string calldata cardId, 
        bytes memory abiEncodedEligibility,
        bytes memory decryptionProof
    ) external {
        require(bytes(identityCards[cardId].cardId).length > 0, "Card does not exist");
        require(!identityCards[cardId].eligibilityVerified, "Eligibility already verified");
        
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(identityCards[cardId].encryptedEligibility);
        
        FHE.checkSignatures(cts, abiEncodedEligibility, decryptionProof);
        
        uint32 decodedEligibility = abi.decode(abiEncodedEligibility, (uint32));
        
        identityCards[cardId].decryptedEligibility = decodedEligibility;
        identityCards[cardId].eligibilityVerified = true;
        
        emit EligibilityVerified(cardId, decodedEligibility);
    }
    
    function getEncryptedAge(string calldata cardId) external view returns (euint32) {
        require(bytes(identityCards[cardId].cardId).length > 0, "Card does not exist");
        return identityCards[cardId].encryptedAge;
    }
    
    function getEncryptedEligibility(string calldata cardId) external view returns (euint32) {
        require(bytes(identityCards[cardId].cardId).length > 0, "Card does not exist");
        return identityCards[cardId].encryptedEligibility;
    }
    
    function getIdentityCard(string calldata cardId) external view returns (
        string memory cardIdValue,
        string memory description,
        address owner,
        uint256 issuanceDate,
        bool ageVerified,
        bool eligibilityVerified,
        uint32 decryptedAge,
        uint32 decryptedEligibility
    ) {
        require(bytes(identityCards[cardId].cardId).length > 0, "Card does not exist");
        IdentityCard storage card = identityCards[cardId];
        
        return (
            card.cardId,
            card.description,
            card.owner,
            card.issuanceDate,
            card.ageVerified,
            card.eligibilityVerified,
            card.decryptedAge,
            card.decryptedEligibility
        );
    }
    
    function getAllCardIds() external view returns (string[] memory) {
        return cardIds;
    }
    
    function isAvailable() public pure returns (bool) {
        return true;
    }
}


