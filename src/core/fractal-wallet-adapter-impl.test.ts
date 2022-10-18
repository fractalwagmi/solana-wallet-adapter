import {
  assertPayloadIsSolanaWalletAdapterApproved,
  assertPayloadIsTransactionSignatureNeededResponsePayload,
  Connection,
  ConnectionManager,
  PopupEvent,
} from '@fractalwagmi/popup-connection';
import {
  WalletConnectionError,
  WalletNotConnectedError,
  WalletPublicKeyError,
  WalletSignTransactionError,
} from '@solana/wallet-adapter-base';
import * as web3 from '@solana/web3.js';
import base58 from 'bs58';
import { FractalWalletAdapterImpl } from 'core/fractal-wallet-adapter-impl';
import { createNonce } from 'core/nonce';
import createMockInstance from 'jest-create-mock-instance';

jest.mock('@fractalwagmi/popup-connection');
jest.mock('core/nonce');

/* eslint-disable @typescript-eslint/no-empty-function */

const TEST_TRANSACTION = new web3.Transaction();
const TEST_SERIALIZED_MESSAGE_RETURN = 'foobar';
const TEST_RESOLVED_TRANSACTION = new web3.Transaction();
const TEST_PUBLIC_KEY_INPUT = 'test-public-key';
const TEST_PUBLIC_KEY = new web3.PublicKey([]);
const TEST_NONCE = 'test-nonce';
const FRACTAL_DOMAIN_HTTPS = 'https://fractal.is';
const APPROVE_PAGE_URL = `${FRACTAL_DOMAIN_HTTPS}/wallet-adapter/approve`;
const SIGN_PAGE_URL = `${FRACTAL_DOMAIN_HTTPS}/wallet-adapter/sign`;
const LOCAL_STORAGE_KEY_FOR_PUBLIC_KEY = 'RdxqNYxF';

let mockAssertPayloadIsSolanaWalletAdapterApproved: jest.Mock;
let mockAssertPayloadIsTransactionSignatureNeededResponsePayload: jest.Mock;
let mockCreateNonce: jest.Mock;
let MockConnectionManagerClass: jest.Mock;
let mockConnectionManager: jest.Mocked<ConnectionManager>;
let mockConnection: jest.Mocked<Connection>;
let transactionPopulateSpy: jest.SpyInstance;

type EventCallback = (payload?: unknown) => void;

beforeEach(() => {
  jest
    .spyOn(TEST_TRANSACTION, 'serializeMessage')
    .mockReturnValue(Buffer.from(TEST_SERIALIZED_MESSAGE_RETURN));

  mockAssertPayloadIsSolanaWalletAdapterApproved =
    assertPayloadIsSolanaWalletAdapterApproved as unknown as jest.Mock;
  mockAssertPayloadIsSolanaWalletAdapterApproved.mockReturnValue(true);

  mockAssertPayloadIsTransactionSignatureNeededResponsePayload =
    assertPayloadIsTransactionSignatureNeededResponsePayload as unknown as jest.Mock;
  mockAssertPayloadIsTransactionSignatureNeededResponsePayload.mockReturnValue(
    true,
  );

  transactionPopulateSpy = jest.spyOn(web3.Transaction, 'populate');

  mockConnection = createMockInstance(Connection);

  mockConnectionManager = createMockInstance(ConnectionManager);
  mockConnectionManager.getConnection.mockReturnValue(mockConnection);

  MockConnectionManagerClass = ConnectionManager as jest.Mock;
  MockConnectionManagerClass.mockClear();
  MockConnectionManagerClass.mockImplementation(() => mockConnectionManager);

  mockCreateNonce = createNonce as jest.Mock;
  mockCreateNonce.mockReturnValue(TEST_NONCE);

  jest.spyOn(web3, 'PublicKey').mockImplementation(() => TEST_PUBLIC_KEY);
});

afterEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
});

describe('FractalWalletAdapterImpl', () => {
  let onConnectionUpdatedCallback: (
    connection: Connection | null,
  ) => void = () => null;
  let onSolanaWalletAdapterApprovedCallback: EventCallback = () => {};
  let onSolanaWalletAdapterDeniedCallback: EventCallback = () => {};
  let onPopupClosed: EventCallback = () => {};

  beforeEach(() => {
    mockConnectionManager.onConnectionUpdated.mockImplementation(callback => {
      onConnectionUpdatedCallback = callback;
      return mockConnectionManager;
    });
    mockConnection.on.mockImplementation((event: PopupEvent, callback) => {
      if (event === PopupEvent.SOLANA_WALLET_ADAPTER_APPROVED) {
        onSolanaWalletAdapterApprovedCallback = callback;
      }
      if (event === PopupEvent.SOLANA_WALLET_ADAPTER_DENIED) {
        onSolanaWalletAdapterDeniedCallback = callback;
      }
      if (event === PopupEvent.POPUP_CLOSED) {
        onPopupClosed = callback;
      }
    });
  });

  describe('connect', () => {
    it('should open the approval page when connecting', () => {
      const wallet = new FractalWalletAdapterImpl();
      wallet.connect();

      expect(mockConnectionManager.open).toHaveBeenLastCalledWith({
        nonce: TEST_NONCE,
        url: `${APPROVE_PAGE_URL}/${TEST_NONCE}`,
      });
    });

    it('should listen for the SOLANA_WALLET_ADAPTER_APPROVED event', () => {
      const wallet = new FractalWalletAdapterImpl();
      wallet.connect();

      onConnectionUpdatedCallback(mockConnection);

      expect(mockConnection.on).toHaveBeenCalledWith(
        PopupEvent.SOLANA_WALLET_ADAPTER_APPROVED,
        expect.any(Function),
      );
    });

    it('handles user denial of popup', async () => {
      const wallet = new FractalWalletAdapterImpl();
      const connectP = wallet.connect();
      onConnectionUpdatedCallback(mockConnection);

      onSolanaWalletAdapterDeniedCallback();
      try {
        await connectP;
      } catch {
        // We need to await `connectP` in order to ensure that the next
        // assertion runs.
      }

      expect(mockConnectionManager.close).toHaveBeenCalled();
      expect(connectP).rejects.toEqual(expect.any(WalletConnectionError));
    });

    it('handles explicit popup closing by user', async () => {
      const wallet = new FractalWalletAdapterImpl();
      const connectP = wallet.connect();
      onConnectionUpdatedCallback(mockConnection);

      onPopupClosed();
      try {
        await connectP;
      } catch {
        // We need to await `connectP` in order to ensure that the next
        // assertion runs.
      }

      expect(mockConnectionManager.close).toHaveBeenCalled();
      expect(connectP).rejects.toEqual(expect.any(WalletConnectionError));
    });

    it('handles invalid payloads', () => {
      mockAssertPayloadIsSolanaWalletAdapterApproved.mockRestore();
      const wallet = new FractalWalletAdapterImpl();
      const connectP = wallet.connect();
      onConnectionUpdatedCallback(mockConnection);

      onSolanaWalletAdapterApprovedCallback({
        someUnknownPayload: 'foobar',
      });

      expect(mockConnectionManager.close).toHaveBeenCalled();
      expect(connectP).rejects.toEqual(expect.any(WalletConnectionError));
    });

    it('handles any wallet public key errors', () => {
      jest.spyOn(web3, 'PublicKey').mockImplementationOnce(() => {
        throw new Error('Some public key error');
      });
      const wallet = new FractalWalletAdapterImpl();
      const connectP = wallet.connect();
      onConnectionUpdatedCallback(mockConnection);
      mockAssertPayloadIsSolanaWalletAdapterApproved.mockReturnValue(true);

      onSolanaWalletAdapterApprovedCallback({
        solanaPublicKey: TEST_PUBLIC_KEY_INPUT,
      });

      expect(mockConnectionManager.close).toHaveBeenCalled();
      expect(connectP).rejects.toEqual(expect.any(WalletPublicKeyError));
    });

    it('resolves only after the public key is made available', async () => {
      const wallet = new FractalWalletAdapterImpl();
      const connectP = wallet.connect();
      onConnectionUpdatedCallback(mockConnection);
      mockAssertPayloadIsSolanaWalletAdapterApproved.mockReturnValue(true);

      onSolanaWalletAdapterApprovedCallback({
        solanaPublicKey: TEST_PUBLIC_KEY_INPUT,
      });
      await connectP;

      expect(web3.PublicKey).toHaveBeenLastCalledWith(TEST_PUBLIC_KEY_INPUT);
      expect(wallet.getPublicKey()).toBe(TEST_PUBLIC_KEY);
      expect(mockConnectionManager.close).toHaveBeenCalled();
    });

    it('stores the public key in localStorage', async () => {
      const wallet = new FractalWalletAdapterImpl();
      const connectP = wallet.connect();
      onConnectionUpdatedCallback(mockConnection);
      mockAssertPayloadIsSolanaWalletAdapterApproved.mockReturnValue(true);

      onSolanaWalletAdapterApprovedCallback({
        solanaPublicKey: TEST_PUBLIC_KEY_INPUT,
      });
      await connectP;

      expect(localStorage.setItem).toHaveBeenLastCalledWith(
        LOCAL_STORAGE_KEY_FOR_PUBLIC_KEY,
        TEST_PUBLIC_KEY_INPUT,
      );
    });

    it('auto-initializes connection from existing public key in localStorage', async () => {
      localStorage.setItem(
        LOCAL_STORAGE_KEY_FOR_PUBLIC_KEY,
        'D3FXGeV4Vas5FFNaQyoTTWog2oUQai1CH6QTvqoytpvf',
      );
      (web3.PublicKey as unknown as jest.SpyInstance).mockRestore();

      const wallet = new FractalWalletAdapterImpl();
      await wallet.connect();

      expect(wallet.getPublicKey()?.toString()).toEqual(
        'D3FXGeV4Vas5FFNaQyoTTWog2oUQai1CH6QTvqoytpvf',
      );
    });
  });

  describe('transactions', () => {
    let wallet: FractalWalletAdapterImpl;
    let onTransactionSignatureNeededResponseCallback: (
      payload: unknown,
    ) => void = () => {};
    let onAuthLoadedCallback: EventCallback = () => {};

    beforeEach(async () => {
      wallet = new FractalWalletAdapterImpl();
      const connectP = wallet.connect();

      onConnectionUpdatedCallback(mockConnection);
      onSolanaWalletAdapterApprovedCallback({
        solanaPublicKey: TEST_PUBLIC_KEY_INPUT,
      });
      return connectP;
    });

    it('checks for wallet readiness', () => {
      wallet = new FractalWalletAdapterImpl();
      expect(wallet.signTransaction(TEST_TRANSACTION)).rejects.toEqual(
        expect.any(WalletNotConnectedError),
      );
    });

    it('opens a popup with a nonce', () => {
      wallet.signTransaction(TEST_TRANSACTION);

      expect(mockConnectionManager.open).toHaveBeenCalledWith(
        expect.objectContaining({
          nonce: TEST_NONCE,
          url: `${SIGN_PAGE_URL}/${TEST_NONCE}`,
        }),
      );
    });

    it('sends a TRANSACTION_SIGNATURE_NEEDED event when the popup is ready', () => {
      jest
        .spyOn(TEST_TRANSACTION, 'serializeMessage')
        .mockReturnValue(Buffer.from('test-serialized-transaction'));
      mockConnectionManager.onConnectionUpdated.mockImplementation(callback => {
        onConnectionUpdatedCallback = callback;
        return mockConnectionManager;
      });

      wallet.signTransaction(TEST_TRANSACTION);
      mockConnection.on.mockImplementation((event, callback) => {
        if (event === PopupEvent.AUTH_LOADED) {
          onAuthLoadedCallback = callback;
        }
      });
      onConnectionUpdatedCallback(mockConnection);

      expect(mockConnection.send).not.toHaveBeenCalledWith({
        event: PopupEvent.TRANSACTION_SIGNATURE_NEEDED,
        payload: expect.objectContaining({
          unsignedB58Transactions: [expect.any(String)],
        }),
      });
      onAuthLoadedCallback();

      expect(mockConnection.send).toHaveBeenLastCalledWith({
        event: PopupEvent.TRANSACTION_SIGNATURE_NEEDED,
        payload: expect.objectContaining({
          unsignedB58Transactions: [expect.any(String)],
        }),
      });
    });

    it('handles invalid payloads', () => {
      // Use the real implementation since we are checking the assertion.
      mockAssertPayloadIsTransactionSignatureNeededResponsePayload.mockRestore();
      jest
        .spyOn(TEST_TRANSACTION, 'serializeMessage')
        .mockReturnValue(Buffer.from('test-serialized-transaction'));
      mockConnectionManager.onConnectionUpdated.mockImplementation(callback => {
        onConnectionUpdatedCallback = callback;
        return mockConnectionManager;
      });

      const signTransactionP = wallet.signTransaction(TEST_TRANSACTION);
      onConnectionUpdatedCallback(mockConnection);
      onTransactionSignatureNeededResponseCallback({
        someUnsupportedPayload: 'foobar',
      });

      expect(signTransactionP).rejects.toEqual(
        expect.any(WalletSignTransactionError),
      );
      expect(mockConnectionManager.close).toHaveBeenCalled();
    });

    it('rejects when the user closes the popup', async () => {
      mockConnectionManager.onConnectionUpdated.mockImplementation(callback => {
        onConnectionUpdatedCallback = callback;
        return mockConnectionManager;
      });
      const signTransactionP = wallet.signTransaction(TEST_TRANSACTION);
      onConnectionUpdatedCallback(mockConnection);

      onPopupClosed();

      try {
        await signTransactionP;
      } catch {
        // just need to await the promise above.
      }

      expect(signTransactionP).rejects.toEqual(
        expect.any(WalletSignTransactionError),
      );
      expect(mockConnectionManager.close).toHaveBeenCalled();
    });

    it('resolves with the signed transactions sent back from the popup', async () => {
      mockConnectionManager.onConnectionUpdated.mockImplementation(callback => {
        onConnectionUpdatedCallback = callback;
        return mockConnectionManager;
      });
      const signTransactionP = wallet.signTransaction(TEST_TRANSACTION);
      transactionPopulateSpy.mockReturnValue(TEST_RESOLVED_TRANSACTION);
      mockConnection.on.mockImplementation((event, callback) => {
        if (event === PopupEvent.TRANSACTION_SIGNATURE_NEEDED_RESPONSE) {
          onTransactionSignatureNeededResponseCallback = callback;
        }
      });
      onConnectionUpdatedCallback(mockConnection);

      onTransactionSignatureNeededResponseCallback({
        signedB58Transactions: [
          base58.encode(Buffer.from('test-signed-transaction')),
        ],
      });
      const result = await signTransactionP;

      expect(result).toBe(TEST_RESOLVED_TRANSACTION);
      expect(mockConnectionManager.close).toHaveBeenCalled();
    });
  });
});
