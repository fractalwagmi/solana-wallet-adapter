import {
  assertPayloadIsMessageSignatureNeededResponsePayload,
  MessageSignatureNeededPayload,
  TransactionSignatureNeededPayload,
  ConnectionManager,
  Platform,
  PopupEvent,
  assertPayloadIsSolanaWalletAdapterApproved,
  DEFAULT_POPUP_HEIGHT_PX,
  assertPayloadIsTransactionSignatureNeededResponsePayload,
} from '@fractalwagmi/popup-connection';
import {
  WalletError,
  WalletNotConnectedError,
  WalletSignTransactionError,
  WalletPublicKeyError,
  WalletConnectionError,
  WalletSignMessageError,
} from '@solana/wallet-adapter-base';
import { Transaction, PublicKey } from '@solana/web3.js';
import base58 from 'bs58';
import { createNonce } from 'core/nonce';

const UNKNOWN_ERROR_MESSAGE = 'Unknown Error';
const FRACTAL_DOMAIN_HTTPS = 'https://fractal.is';
const APPROVE_PAGE_URL = `${FRACTAL_DOMAIN_HTTPS}/wallet-adapter/approve`;
const SIGN_PAGE_URL = `${FRACTAL_DOMAIN_HTTPS}/wallet-adapter/sign`;
const SIGN_MESSAGE_PAGE_URL = `${FRACTAL_DOMAIN_HTTPS}/wallet-adapter/sign/message`;
const MIN_POPUP_HEIGHT_PX = DEFAULT_POPUP_HEIGHT_PX;
const MAX_POPUP_WIDTH_PX = 850;
const LOCAL_STORAGE_KEY_FOR_PUBLIC_KEY = 'RdxqNYxF';

export class FractalWalletAdapterImpl {
  private readonly popupManager = new ConnectionManager(
    Platform.SOLANA_WALLET_ADAPTER,
  );

  private publicKey: PublicKey | null = null;
  private connecting = false;

  getPublicKey(): PublicKey | null {
    return this.publicKey;
  }

  async connect(): Promise<void> {
    let resolve: () => void | undefined;
    let reject: (err: unknown) => void | undefined;

    const publicKeyInLocalStorage = window.localStorage.getItem(
      LOCAL_STORAGE_KEY_FOR_PUBLIC_KEY,
    );
    if (publicKeyInLocalStorage) {
      this.publicKey = new PublicKey(publicKeyInLocalStorage);
      return Promise.resolve();
    }

    const nonce = createNonce();
    this.popupManager.open({
      nonce,
      url: `${APPROVE_PAGE_URL}/${nonce}`,
    });

    const handleSolanaWalletAdapterApproved = (payload: unknown) => {
      if (!assertPayloadIsSolanaWalletAdapterApproved(payload)) {
        reject(
          new WalletConnectionError(
            'Malformed payload when setting up connection. ' +
              'Expected { solanaPublicKey: string } but ' +
              `received ${JSON.stringify(payload)}`,
          ),
        );
        this.popupManager.close();
        return;
      }
      try {
        this.publicKey = new PublicKey(payload.solanaPublicKey);
        window.localStorage.setItem(
          LOCAL_STORAGE_KEY_FOR_PUBLIC_KEY,
          payload.solanaPublicKey,
        );
        resolve();
      } catch (error: unknown) {
        const publicKeyError = new WalletPublicKeyError(
          error instanceof Error ? error.message : UNKNOWN_ERROR_MESSAGE,
          error,
        );
        reject(publicKeyError);
      }
      this.popupManager.close();
    };

    const handleExplicitDenialByUser = () => {
      reject(new WalletConnectionError('The user denied the connection.'));
      this.popupManager.close();
    };

    const handleClosedByUser = () => {
      reject(new WalletConnectionError('The user denied the connection.'));
      this.popupManager.close();
    };

    this.popupManager.onConnectionUpdated(connection => {
      if (!connection) {
        return;
      }
      connection.on(
        PopupEvent.SOLANA_WALLET_ADAPTER_APPROVED,
        handleSolanaWalletAdapterApproved,
      );
      connection.on(
        PopupEvent.SOLANA_WALLET_ADAPTER_DENIED,
        handleExplicitDenialByUser,
      );
      connection.on(PopupEvent.POPUP_CLOSED, handleClosedByUser);
    });

    return new Promise((promiseResolver, promiseRejector) => {
      resolve = promiseResolver;
      reject = promiseRejector;
    });
  }

  async disconnect(): Promise<void> {
    this.popupManager.tearDown();
    this.publicKey = null;
    window.localStorage.removeItem(LOCAL_STORAGE_KEY_FOR_PUBLIC_KEY);
  }

  async signTransaction<T extends Transaction>(transaction: T): Promise<T> {
    try {
      this.checkWalletReadiness();
      const result = await this.signTransactions([transaction]);
      return result[0];
    } catch (error: unknown) {
      let errorToThrow = error;
      if (!(error instanceof WalletError)) {
        errorToThrow = new WalletSignTransactionError(
          error instanceof Error ? error.message : UNKNOWN_ERROR_MESSAGE,
          error,
        );
      }
      throw errorToThrow;
    }
  }

  async signAllTransactions<T extends Transaction>(
    transactions: T[],
  ): Promise<T[]> {
    try {
      this.checkWalletReadiness();
      const result = await this.signTransactions(transactions);
      return result;
    } catch (error: unknown) {
      let errorToThrow = error;
      if (!(error instanceof WalletError)) {
        errorToThrow = new WalletSignTransactionError(
          error instanceof Error ? error.message : UNKNOWN_ERROR_MESSAGE,
          error,
        );
      }
      throw errorToThrow;
    }
  }

  async signMessage(encodedMessage: Uint8Array): Promise<Uint8Array> {
    const decodedMessage = new TextDecoder().decode(encodedMessage);

    let resolve: (encodedSignature: Uint8Array) => void;
    let reject: (err: WalletError) => void;

    const handleMessageSignatureNeededResponse = (payload: unknown) => {
      if (!assertPayloadIsMessageSignatureNeededResponsePayload(payload)) {
        const error = new WalletSignMessageError(
          'Malformed payload when signing message. ' +
            'Expected { decodedSignature: string } ' +
            `but received ${JSON.stringify(payload)}`,
        );
        reject(error);
        this.popupManager.close();
        return;
      }

      const encodedSignature = Uint8Array.from(
        payload.decodedSignature.split(',').map(n => Number(n)),
      );
      resolve(encodedSignature);
      this.popupManager.close();
    };

    const handleClosedOrDeniedByUser = () => {
      reject(
        new WalletSignMessageError('The user did not approve the message'),
      );
      this.popupManager.close();
    };

    const handleAuthLoaded = () => {
      const payload: MessageSignatureNeededPayload = {
        decodedMessage,
      };
      this.popupManager.getConnection()?.send({
        event: PopupEvent.MESSAGE_SIGNATURE_NEEDED,
        payload,
      });
    };

    const nonce = createNonce();
    this.popupManager.open({
      heightPx: Math.max(
        MIN_POPUP_HEIGHT_PX,
        Math.floor(window.innerHeight * 0.8),
      ),
      nonce,
      url: `${SIGN_MESSAGE_PAGE_URL}/${nonce}`,
      widthPx: Math.min(
        MAX_POPUP_WIDTH_PX,
        Math.floor(window.innerWidth * 0.8),
      ),
    });
    this.popupManager.onConnectionUpdated(connection => {
      if (!connection) {
        return;
      }

      connection.on(
        PopupEvent.MESSAGE_SIGNATURE_NEEDED_RESPONSE,
        handleMessageSignatureNeededResponse,
      );
      connection.on(PopupEvent.TRANSACTION_DENIED, handleClosedOrDeniedByUser);
      connection.on(PopupEvent.POPUP_CLOSED, handleClosedOrDeniedByUser);
      connection.on(PopupEvent.AUTH_LOADED, handleAuthLoaded);
    });

    return new Promise<Uint8Array>((promiseResolver, promiseRejector) => {
      resolve = promiseResolver;
      reject = promiseRejector;
    });
  }

  private async signTransactions<T extends Transaction>(
    transactions: T[],
  ): Promise<T[]> {
    let resolve: (signedTransactions: T[]) => void;
    let reject: (err: WalletError) => void;

    const handleTransactionSignatureNeededResponse = (payload: unknown) => {
      if (!assertPayloadIsTransactionSignatureNeededResponsePayload(payload)) {
        const error = new WalletSignTransactionError(
          'Malformed payload when signing transactions. ' +
            'Expected { signedB58Transactions: string[] } ' +
            `but received ${JSON.stringify(payload)}`,
        );
        reject(error);
        this.popupManager.close();
        return;
      }

      const signedTransactions = payload.signedB58Transactions.map(
        signedB58Transaction => {
          return Transaction.from(base58.decode(signedB58Transaction));
        },
      ) as T[];

      resolve(signedTransactions);
      this.popupManager.close();
    };

    const handleClosedOrDeniedByUser = () => {
      reject(
        new WalletSignTransactionError(
          'The user did not approve the transaction',
        ),
      );
      this.popupManager.close();
    };

    const handleAuthLoaded = () => {
      const payload: TransactionSignatureNeededPayload = {
        unsignedB58Transactions: transactions.map(t =>
          base58.encode(t.serializeMessage()),
        ),
      };
      this.popupManager.getConnection()?.send({
        event: PopupEvent.TRANSACTION_SIGNATURE_NEEDED,
        payload,
      });
    };

    const nonce = createNonce();
    this.popupManager.open({
      heightPx: Math.max(
        MIN_POPUP_HEIGHT_PX,
        Math.floor(window.innerHeight * 0.8),
      ),
      nonce,
      url: `${SIGN_PAGE_URL}/${nonce}`,
      widthPx: Math.min(
        MAX_POPUP_WIDTH_PX,
        Math.floor(window.innerWidth * 0.8),
      ),
    });
    this.popupManager.onConnectionUpdated(connection => {
      if (!connection) {
        return;
      }

      connection.on(
        PopupEvent.TRANSACTION_SIGNATURE_NEEDED_RESPONSE,
        handleTransactionSignatureNeededResponse,
      );
      connection.on(PopupEvent.TRANSACTION_DENIED, handleClosedOrDeniedByUser);
      connection.on(PopupEvent.POPUP_CLOSED, handleClosedOrDeniedByUser);
      connection.on(PopupEvent.AUTH_LOADED, handleAuthLoaded);
    });

    return new Promise<T[]>((promiseResolver, promiseRejector) => {
      resolve = promiseResolver;
      reject = promiseRejector;
    });
  }

  private checkWalletReadiness() {
    if (this.publicKey === null) {
      throw new WalletNotConnectedError(
        '`publicKey` is null. Did you forget to call `.connect()`?',
      );
    }
  }
}
