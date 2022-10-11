import type { TransactionSignatureNeededPayload } from '@fractalwagmi/popup-connection';
import {
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
} from '@solana/wallet-adapter-base';
import { Message, Transaction, PublicKey } from '@solana/web3.js';
import base58 from 'bs58';
import { createNonce } from 'core/nonce';

const UNKNOWN_ERROR_MESSAGE = 'Unknown Error';
const FRACTAL_DOMAIN_HTTPS = 'https://fractal.is';
const APPROVE_PAGE_URL = `${FRACTAL_DOMAIN_HTTPS}/wallet-adapter/approve`;
const SIGN_PAGE_URL = `${FRACTAL_DOMAIN_HTTPS}/wallet-adapter/sign`;
const MIN_POPUP_HEIGHT_PX = DEFAULT_POPUP_HEIGHT_PX;
const MAX_POPUP_WIDTH_PX = 850;

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
        return;
      }

      const signedTransactions = payload.signedB58Transactions.map(
        signedB58Transaction => {
          const message = Message.from(base58.decode(signedB58Transaction));
          return Transaction.populate(message);
        },
      ) as T[];

      resolve(signedTransactions);
    };

    const handleClosedByUser = () => {
      reject(
        new WalletSignTransactionError(
          'The user did not approve the transaction',
        ),
      );
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

      connection.on(PopupEvent.POPUP_CLOSED, handleClosedByUser);

      const payload: TransactionSignatureNeededPayload = {
        unsignedB58Transactions: transactions.map(t =>
          base58.encode(t.serializeMessage()),
        ),
      };
      connection.send({
        event: PopupEvent.TRANSACTION_SIGNATURE_NEEDED,
        payload,
      });
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
