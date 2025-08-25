
;; GreenGrant Smart Contract
;; A charity funding contract that releases donations to eco-projects only upon verified project milestones

;; Constants
(define-constant CONTRACT_OWNER tx-sender)
(define-constant ERR_OWNER_ONLY (err u100))
(define-constant ERR_PROJECT_NOT_FOUND (err u101))
(define-constant ERR_PROJECT_ALREADY_EXISTS (err u102))
(define-constant ERR_INVALID_STATUS (err u103))
(define-constant ERR_INSUFFICIENT_FUNDS (err u104))
(define-constant ERR_MILESTONE_NOT_FOUND (err u105))

;; Project statuses
(define-constant PROJECT_STATUS_PENDING u0)
(define-constant PROJECT_STATUS_ACTIVE u1)
(define-constant PROJECT_STATUS_COMPLETED u2)
(define-constant PROJECT_STATUS_CANCELLED u3)

;; Data structures
(define-map projects 
  { project-id: uint }
  {
    owner: principal,
    title: (string-ascii 256),
    description: (string-ascii 1024),
    target-amount: uint,
    raised-amount: uint,
    status: uint,
    created-at: uint,
    category: (string-ascii 64)
  }
)

(define-map project-milestones
  { project-id: uint, milestone-id: uint }
  {
    title: (string-ascii 256),
    description: (string-ascii 512),
    amount: uint,
    verified: bool,
    verifier: (optional principal),
    verified-at: (optional uint)
  }
)

;; Global variables
(define-data-var next-project-id uint u1)
(define-data-var contract-owner principal CONTRACT_OWNER)

;; Private functions
(define-private (is-contract-owner)
  (is-eq tx-sender (var-get contract-owner))
)

;; Public functions

;; Register a new eco-project for funding
(define-public (register-project 
  (title (string-ascii 256))
  (description (string-ascii 1024))
  (target-amount uint)
  (category (string-ascii 64))
)
  (let ((project-id (var-get next-project-id)))
    ;; Validate inputs
    (asserts! (> (len title) u0) ERR_INVALID_STATUS)
    (asserts! (> (len description) u0) ERR_INVALID_STATUS)
    (asserts! (> (len category) u0) ERR_INVALID_STATUS)
    (asserts! (> target-amount u0) ERR_INVALID_STATUS)
    
    ;; Insert project into map
    (map-set projects 
      { project-id: project-id }
      {
        owner: tx-sender,
        title: title,
        description: description,
        target-amount: target-amount,
        raised-amount: u0,
        status: PROJECT_STATUS_PENDING,
        created-at: block-height,
        category: category
      }
    )
    
    ;; Increment project counter
    (var-set next-project-id (+ project-id u1))
    
    (ok project-id)
  )
)

;; Get project details
(define-read-only (get-project (project-id uint))
  (map-get? projects { project-id: project-id })
)

;; Get total number of projects
(define-read-only (get-total-projects)
  (- (var-get next-project-id) u1)
)

;; Check if user is project owner
(define-read-only (is-project-owner (project-id uint) (user principal))
  (match (map-get? projects { project-id: project-id })
    project (is-eq (get owner project) user)
    false
  )
)
